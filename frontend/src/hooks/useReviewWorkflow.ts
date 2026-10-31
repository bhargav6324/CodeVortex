/**
 * All reviewer-page state and API calls in one place.
 *
 * Key rules from the contract that this hook enforces:
 * - One action at a time. Buttons are disabled while anything is in flight.
 * - Every new click gets a new idempotency key. A retry of the SAME action reuses the
 *   same key and the exact same body, so the backend can never apply it twice.
 * - Nothing is marked approved or sent until the backend returns that Draft.
 * - Lost review response -> GET the draft first; retry with the same key only if the
 *   outcome is still unknown.
 * - 409 stale revision -> reload and make the reviewer look again. Never auto-approve.
 * - The active draft and any unconfirmed action are kept in sessionStorage for recovery.
 */
import { useEffect, useRef, useState } from 'react'
import { createDraft, getContext, getDraft, reviewDraft } from '../api/endpoints'
import { ApiError, toApiError } from '../api/errors'
import type { Context, Draft, ReviewDecision, ReviewRequest } from '../types/contract'
import { newIdempotencyKey } from '../utils/ids'
import { recordDraft } from '../features/session/sessionLog'
import { STATUS_DISPLAY } from '../utils/labels'
import { clearSession, loadSession, saveSession, type PendingAction, type SavedSession } from '../utils/session'

export type BusyAction = 'create' | 'refresh' | 'edit' | 'approve' | 'reject' | 'retry' | 'resume'

export interface Failure {
  /** Where the failure happened, so the UI shows it next to the right buttons. */
  scope: 'create' | 'refresh' | 'review'
  decision: ReviewDecision | null
  error: ApiError
  /** True when the same action may be retried with the same key. */
  canRetry: boolean
  /** Earliest time (ms) a retry is allowed, from Retry-After. */
  retryReadyAt: number | null
  /** Extra guidance that replaces the default hint. */
  hint: string | null
}

export interface Notice {
  tone: 'success' | 'info' | 'warning'
  title: string
  text: string | null
}

/** Shown after a page reload when there is a draft or an unconfirmed action to recover. */
export type Resumable = SavedSession

function hasSomethingToResume(s: SavedSession | null): s is SavedSession {
  return s !== null && (s.draftId !== null || s.pending !== null)
}

function successNotice(draft: Draft): Notice {
  switch (draft.status) {
    case 'mock_sent':
      return {
        tone: 'success',
        title: 'Mock sent.',
        text: `Delivery ID ${draft.delivery_id ?? 'unknown'}. One entry was written to the mock outbox; no real email was sent.`,
      }
    case 'approved':
      return { tone: 'success', title: 'Approved as draft only.', text: 'Nothing was sent. A draft-only approval cannot be sent later.' }
    case 'rejected':
      return { tone: 'info', title: 'Draft rejected.', text: 'Nothing was sent.' }
    case 'ready_for_review':
      return { tone: 'success', title: `Edit saved as revision ${draft.revision}.`, text: 'Review the updated draft before approving.' }
    case 'blocked':
      return { tone: 'warning', title: 'The draft is blocked.', text: null }
  }
}

/** Placeholder error for an action whose outcome was lost because the page reloaded. */
function unknownOutcomeError(): ApiError {
  return new ApiError({
    status: null,
    code: 'NETWORK_ERROR',
    message: 'The page was reloaded before the last action finished, so its outcome is unknown.',
    requestId: '-',
    retryable: true,
    retryAfterSeconds: null,
    details: [],
  })
}

export function useReviewWorkflow(defaultCustomerId: string) {
  const [saved] = useState(loadSession)

  const [customerId, setCustomerId] = useState(saved?.customerId ?? defaultCustomerId)
  const [context, setContext] = useState<Context | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<ApiError | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(saved?.pending ?? null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** Draft whose data/policy snapshot is stale: approval must not be offered. */
  const [staleDraftId, setStaleDraftId] = useState<string | null>(null)
  const [resumable, setResumable] = useState<Resumable | null>(hasSomethingToResume(saved) ? saved : null)

  // The customer currently on screen. Late responses for another customer are ignored.
  const activeCustomer = useRef(customerId)
  // Synchronous guard so a fast double-click cannot start two actions.
  const busyRef = useRef(false)

  // Keep the recovery state in sessionStorage.
  useEffect(() => {
    saveSession({ customerId, draftId: draft?.draft_id ?? resumable?.draftId ?? null, pending })
  }, [customerId, draft?.draft_id, resumable?.draftId, pending])

  function begin(action: BusyAction): boolean {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(action)
    return true
  }

  function end() {
    busyRef.current = false
    setBusy(null)
  }

  const isActive = (id: string) => activeCustomer.current === id

  // ---------------------------------------------------------------------------
  // Customer context
  // ---------------------------------------------------------------------------

  async function loadContext(id: string) {
    activeCustomer.current = id
    setContextLoading(true)
    setContextError(null)
    try {
      const res = await getContext(id)
      if (isActive(id)) setContext(res.data)
    } catch (e) {
      if (isActive(id)) {
        setContext(null)
        setContextError(toApiError(e))
      }
    } finally {
      if (isActive(id)) setContextLoading(false)
    }
  }

  /** Background refresh after approval (contacts may change); errors are ignored. */
  async function reloadContextQuietly(id: string) {
    try {
      const res = await getContext(id)
      if (isActive(id)) setContext(res.data)
    } catch {
      // The visible context stays as it was.
    }
  }

  function selectCustomer(id: string, load: boolean) {
    if (busyRef.current) return
    activeCustomer.current = id
    setCustomerId(id)
    setContext(null)
    setContextError(null)
    setDraft(null)
    setPending(null)
    setFailure(null)
    setNotice(null)
    setStaleDraftId(null)
    setResumable(null)
    if (load) void loadContext(id)
  }

  // ---------------------------------------------------------------------------
  // Failure handling
  // ---------------------------------------------------------------------------

  async function handleFailure(action: PendingAction, thrown: unknown) {
    const error = toApiError(thrown)
    if (!isActive(action.customerId)) return

    const decision = action.kind === 'review' ? action.body.decision : null
    const scope: Failure['scope'] = action.kind === 'review' ? 'review' : 'create'
    const retryReadyAt = error.retryAfterSeconds !== null ? Date.now() + error.retryAfterSeconds * 1000 : null
    const record = (canRetry: boolean, hint: string | null = null) => {
      setPending(canRetry ? action : null)
      setFailure({ scope, decision, error, canRetry, retryReadyAt, hint })
    }

    if (action.kind === 'review' && error.outcomeUnknown) {
      // We don't know whether the review was applied. Check the draft before offering a retry.
      if (await reviewWasApplied(action)) return
      record(true)
      return
    }

    if (action.kind === 'review' && error.code === 'VERSION_CONFLICT' && !error.retryable) {
      setPending(null)
      const hint = await reloadAfterConflict(action)
      setFailure({ scope, decision, error, canRetry: false, retryReadyAt: null, hint })
      return
    }

    if (action.kind === 'review' && error.code === 'INVALID_TRANSITION') {
      setPending(null)
      await reloadDraftQuietly(action.draftId, action.customerId)
      setFailure({ scope, decision, error, canRetry: false, retryReadyAt: null, hint: null })
      return
    }

    // Retry is allowed when the backend says so, or after fixing the token.
    record(error.retryable || error.code === 'UNAUTHORIZED')
  }

  /** After a lost review response: true if the server already changed the draft. */
  async function reviewWasApplied(action: Extract<PendingAction, { kind: 'review' }>): Promise<boolean> {
    try {
      const latest = (await getDraft(action.draftId)).data
      if (!isActive(action.customerId)) return true
      if (latest.revision !== action.body.expected_revision) {
        setDraft(latest)
        setPending(null)
        setFailure(null)
        setNotice({
          tone: 'warning',
          title: 'The response was lost, but the draft changed on the server.',
          text: `It is now revision ${latest.revision} (${STATUS_DISPLAY[latest.status].label}). Check it before doing anything else.`,
        })
        return true
      }
    } catch {
      // Still unknown: fall through and offer a retry with the same key.
    }
    return false
  }

  /** 409 VERSION_CONFLICT on review: reload and explain what the reviewer must do. */
  async function reloadAfterConflict(action: Extract<PendingAction, { kind: 'review' }>): Promise<string> {
    void reloadContextQuietly(action.customerId)
    try {
      const latest = (await getDraft(action.draftId)).data
      if (!isActive(action.customerId)) return ''
      setDraft(latest)
      if (latest.revision === action.body.expected_revision) {
        // Same revision but still a conflict: the data/policy snapshot behind the draft is stale.
        setStaleDraftId(latest.draft_id)
        return 'Customer data or policy changed since this draft was generated. Generate a new draft; this one cannot be approved.'
      }
      return `The draft changed on the server and is now revision ${latest.revision}. Review the latest content before taking a new action.`
    } catch {
      return 'The draft changed on the server. Refresh it and review the latest content before acting again.'
    }
  }

  async function reloadDraftQuietly(draftId: string, id: string) {
    try {
      const latest = (await getDraft(draftId)).data
      if (isActive(id)) setDraft(latest)
    } catch {
      // Keep what is on screen.
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function runCreate(action: Extract<PendingAction, { kind: 'create' }>) {
    setPending(action)
    setFailure(null)
    setNotice(null)
    const started = performance.now()
    try {
      const res = await createDraft(action.customerId, action.key)
      // Session statistics: draft ID and browser-measured time only (replays have no new timing).
      recordDraft({
        draftId: res.data.draft_id,
        customerId: res.data.customer_id,
        generationMs: res.status === 201 ? Math.round(performance.now() - started) : null,
        source: 'review',
      })
      if (!isActive(action.customerId)) return
      setDraft(res.data)
      setStaleDraftId(null)
      setPending(null)
      if (res.status === 200) {
        setNotice({ tone: 'info', title: 'Recovered the draft created by your earlier request.', text: null })
      }
    } catch (e) {
      await handleFailure(action, e)
    }
  }

  async function runReview(action: Extract<PendingAction, { kind: 'review' }>) {
    setPending(action)
    setFailure(null)
    setNotice(null)
    try {
      const res = await reviewDraft(action.draftId, action.body, action.key)
      if (!isActive(action.customerId)) return
      setDraft(res.data)
      setPending(null)
      setNotice(successNotice(res.data))
      if (action.body.decision === 'approve') void reloadContextQuietly(action.customerId)
    } catch (e) {
      await handleFailure(action, e)
    }
  }

  async function generate() {
    if (context === null || !begin('create')) return
    try {
      await runCreate({ kind: 'create', customerId: context.customer.customer_id, key: newIdempotencyKey('create') })
    } finally {
      end()
    }
  }

  async function review(body: ReviewRequest) {
    if (draft === null || !begin(body.decision)) return
    try {
      await runReview({
        kind: 'review',
        customerId: draft.customer_id,
        draftId: draft.draft_id,
        key: newIdempotencyKey('review'),
        body,
      })
    } finally {
      end()
    }
  }

  /** Retry the failed action with the SAME key and body. */
  async function retry() {
    if (pending === null || !begin('retry')) return
    try {
      if (pending.kind === 'create') await runCreate(pending)
      else await runReview(pending)
    } finally {
      end()
    }
  }

  function discardFailure() {
    setPending(null)
    setFailure(null)
  }

  async function refresh() {
    if (draft === null || !begin('refresh')) return
    const { draft_id: draftId, customer_id: id } = draft
    setFailure(null)
    try {
      const res = await getDraft(draftId)
      if (isActive(id)) setDraft(res.data)
    } catch (e) {
      if (isActive(id)) {
        setFailure({ scope: 'refresh', decision: null, error: toApiError(e), canRetry: false, retryReadyAt: null, hint: null })
      }
    } finally {
      end()
    }
  }

  /** Restore the draft (and any unconfirmed action) saved before a page reload. */
  async function resume() {
    if (resumable === null || !begin('resume')) return
    const saved = resumable
    const id = saved.customerId
    activeCustomer.current = id
    setCustomerId(id)
    setResumable(null)
    setFailure(null)
    setNotice(null)
    try {
      void loadContext(id)
      const draftId = saved.draftId ?? (saved.pending?.kind === 'review' ? saved.pending.draftId : null)
      if (draftId !== null) {
        try {
          const res = await getDraft(draftId)
          if (isActive(id)) setDraft(res.data)
        } catch (e) {
          if (isActive(id)) {
            setFailure({ scope: 'refresh', decision: null, error: toApiError(e), canRetry: false, retryReadyAt: null, hint: null })
          }
        }
      }
      const action = saved.pending
      if (action !== null) {
        if (action.kind === 'review' && (await reviewWasApplied(action))) return
        setPending(action)
        setFailure({
          scope: action.kind === 'review' ? 'review' : 'create',
          decision: action.kind === 'review' ? action.body.decision : null,
          error: unknownOutcomeError(),
          canRetry: true,
          retryReadyAt: null,
          hint:
            action.kind === 'create'
              ? 'Retry to recover the draft from your earlier request (same key, no duplicate), or discard it.'
              : 'Retry the same action safely (same key, cannot apply twice), or discard it.',
        })
      }
    } finally {
      end()
    }
  }

  function dismissResume() {
    setResumable(null)
    setPending(null)
  }

  /** Clear everything (used with "Reset mock data"). */
  function resetAll() {
    if (busyRef.current) return
    clearSession()
    setDraft(null)
    setPending(null)
    setFailure(null)
    setNotice(null)
    setStaleDraftId(null)
    setResumable(null)
  }

  return {
    customerId,
    context,
    contextLoading,
    contextError,
    clearContextError: () => setContextError(null),
    draft,
    busy,
    failure,
    notice,
    dismissNotice: () => setNotice(null),
    isStale: draft !== null && staleDraftId === draft.draft_id,
    resumable,
    hasPendingRetry: pending !== null && failure?.canRetry === true,
    selectCustomer,
    loadContext,
    generate,
    review,
    retry,
    discardFailure,
    refresh,
    resume,
    dismissResume,
    resetAll,
  }
}

/**
 * Conversation state and the calls behind it. Kept in memory only (lost on reload), apart
 * from draft IDs recorded for the session statistics.
 *
 * Same client rules as the review workspace: one action at a time, a new idempotency key
 * per action, and "Try again" reuses the SAME key and body.
 */
import { useRef, useState, type ReactNode } from 'react'
import { buildApproveRequest, buildEditRequest, buildRejectRequest, createDraft, getContext, getDraft, reviewDraft } from '../../api/endpoints'
import { toApiError } from '../../api/errors'
import { useToken } from '../../app/context'
import type { Context, Delivery, Draft, ReviewRequest } from '../../types/contract'
import { newIdempotencyKey } from '../../utils/ids'
import { recordDraft } from '../session/sessionLog'
import { AssistantContext, HELP_TEXT, parseIntent, type ChatMessage } from './assistantContext'

type Action =
  | { kind: 'create'; customerId: string; key: string }
  | { kind: 'review'; draftId: string; key: string; body: ReviewRequest; label: string }

let counter = 0
const nextId = () => `m${++counter}`

function reviewHeadline(draft: Draft, decision: ReviewRequest['decision']): string {
  if (decision === 'edit') return `Saved your edit as revision ${draft.revision}. Here is the updated draft and its checks.`
  if (draft.status === 'mock_sent') return `Approved and mock-sent. Delivery ID ${draft.delivery_id ?? 'unknown'}. No real email was sent.`
  if (draft.status === 'approved') return `Approved as draft only by ${draft.approved_by ?? 'the reviewer'}. Nothing was sent.`
  if (draft.status === 'rejected') return draft.feedback ? `Rejected, with your feedback: “${draft.feedback}”.` : 'Rejected. Nothing was sent.'
  return `The draft is now ${draft.status}.`
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { tokenSet, focusTokenInput } = useToken()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<{ draft: Draft; context: Context | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [editRefused, setEditRefused] = useState(false)
  const [pending, setPending] = useState<Action | null>(null)
  const busyRef = useRef(false)

  const push = (...msgs: ChatMessage[]) => setMessages((prev) => [...prev, ...msgs])
  const replace = (id: string, msg: ChatMessage) => setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)))
  const say = (text: string, tone: 'normal' | 'warning' = 'normal') => push({ id: nextId(), role: 'assistant', kind: 'text', text, tone })

  async function run(action: Action) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPending(action)
    const thinkingId = nextId()
    push({ id: thinkingId, role: 'assistant', kind: 'thinking', text: action.kind === 'create' ? `Looking up ${action.customerId} and preparing a draft…` : `${action.label}…` })
    try {
      if (action.kind === 'create') {
        const ctx = (await getContext(action.customerId)).data
        const started = performance.now()
        const res = await createDraft(action.customerId, action.key)
        const ms = res.status === 201 ? Math.round(performance.now() - started) : null
        recordDraft({ draftId: res.data.draft_id, customerId: res.data.customer_id, generationMs: ms, source: 'assistant' })
        setCurrent({ draft: res.data, context: ctx })
        setEditing(false)
        replace(thinkingId, {
          id: thinkingId,
          role: 'assistant',
          kind: 'draft',
          headline: res.data.status === 'blocked' ? `I checked ${ctx.customer.display_name} (${action.customerId}).` : `Here is my draft for ${ctx.customer.display_name} (${action.customerId}).`,
          draft: res.data,
          context: ctx,
          ms,
        })
      } else {
        const res = await reviewDraft(action.draftId, action.body, action.key)
        setCurrent((c) => ({ draft: res.data, context: c?.context ?? null }))
        setEditing(false)
        setEditRefused(false)
        replace(thinkingId, { id: thinkingId, role: 'assistant', kind: 'draft', headline: reviewHeadline(res.data, action.body.decision), draft: res.data, context: current?.context ?? null, ms: null })
      }
      setPending(null)
    } catch (e) {
      const error = toApiError(e)
      const canRetry = error.retryable || error.outcomeUnknown || error.code === 'UNAUTHORIZED'
      if (!canRetry) setPending(null)
      if (error.code === 'UNAUTHORIZED') focusTokenInput()
      if (action.kind === 'review' && action.body.decision === 'edit' && error.code === 'REVIEW_BLOCKED') setEditRefused(true)
      replace(thinkingId, { id: thinkingId, role: 'assistant', kind: 'error', title: action.kind === 'create' ? 'I could not prepare that draft' : `I could not complete “${action.label}”`, error, canRetry })
      // A stale revision or a final draft: reload so the conversation shows the real state.
      if (action.kind === 'review' && (error.code === 'VERSION_CONFLICT' || error.code === 'INVALID_TRANSITION') && !error.retryable) {
        try {
          const latest = (await getDraft(action.draftId)).data
          setCurrent((c) => ({ draft: latest, context: c?.context ?? null }))
          push({ id: nextId(), role: 'assistant', kind: 'draft', headline: `The draft changed on the server. This is revision ${latest.revision}; please look again before acting.`, draft: latest, context: current?.context ?? null, ms: null })
        } catch {
          // Keep the error bubble.
        }
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function needToken(): boolean {
    if (tokenSet) return false
    say('Paste your reviewer token in the box at the top right first. I need it for every request.', 'warning')
    focusTokenInput()
    return true
  }

  function reviewAction(body: ReviewRequest, label: string) {
    if (!current) return say('There is no draft yet. Ask me to “Draft an email for C004” first.')
    if (needToken()) return
    void run({ kind: 'review', draftId: current.draft.draft_id, key: newIdempotencyKey('review'), body, label })
  }

  const value = {
    messages,
    busy,
    current: current?.draft ?? null,
    currentContext: current?.context ?? null,
    editing,
    editRefused,
    canRetry: pending !== null && !busy,
    send: (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '' || busyRef.current) return
      push({ id: nextId(), role: 'user', text: trimmed })
      const intent = parseIntent(trimmed)
      switch (intent.type) {
        case 'draft':
          if (needToken()) return
          void run({ kind: 'create', customerId: intent.customerId, key: newIdempotencyKey('create') })
          return
        case 'approve':
          reviewAction(buildApproveRequest(current?.draft.revision ?? 1, intent.delivery), intent.delivery === 'mock_email' ? 'Approve and mock-send' : 'Approve draft')
          return
        case 'reject':
          reviewAction(buildRejectRequest(current?.draft.revision ?? 1, intent.feedback), 'Reject')
          return
        case 'edit':
          if (!current) return say('There is no draft to edit yet.')
          if (current.draft.message === null) return say('This draft has no message to edit.')
          setEditing(true)
          say('The editor is open under the draft. Only formatting fixes pass in this version; wording must match the approved template.')
          return
        case 'outOfRange':
          say(`${intent.raw.toUpperCase()} is not in the dataset. ${HELP_TEXT}`)
          return
        default:
          say(HELP_TEXT)
      }
    },
    approve: (delivery: Delivery) => {
      push({ id: nextId(), role: 'user', text: delivery === 'mock_email' ? 'Approve and mock-send' : 'Approve draft' })
      reviewAction(buildApproveRequest(current?.draft.revision ?? 1, delivery), delivery === 'mock_email' ? 'Approve and mock-send' : 'Approve draft')
    },
    reject: (feedback: string | null) => {
      push({ id: nextId(), role: 'user', text: feedback ? `Reject: ${feedback}` : 'Reject' })
      reviewAction(buildRejectRequest(current?.draft.revision ?? 1, feedback), 'Reject')
    },
    openEditor: () => setEditing(true),
    closeEditor: () => {
      setEditing(false)
      setEditRefused(false)
    },
    saveEdit: (subject: string, body: string) => {
      push({ id: nextId(), role: 'user', text: 'Save my edit' })
      reviewAction(buildEditRequest(current?.draft.revision ?? 1, subject, body), 'Save edit')
    },
    retry: () => {
      if (pending) void run(pending)
    },
    clear: () => {
      if (busyRef.current) return
      setMessages([])
      setCurrent(null)
      setEditing(false)
      setEditRefused(false)
      setPending(null)
    },
  }

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

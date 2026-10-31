/**
 * Proposed v1.1.0: loads GET /drafts/{id}/details (offer eligibility, audit trail, mock
 * outbox row, ratings) and submits reviewer ratings. Does nothing when `enabled` is false.
 *
 * Same safety rules as the review actions: one rating request at a time, a new idempotency
 * key per click, and a retry reuses the same key and body.
 *
 * Every stored result is tagged with its draft_id, and only results for the draft on
 * screen are returned — so switching drafts never shows another draft's details.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraftDetails, submitRating } from '../api/endpoints'
import { toApiError, type ApiError } from '../api/errors'
import type { Draft } from '../types/contract'
import type { DraftDetails, RatingRequest } from '../types/contractV11'
import { newIdempotencyKey } from '../utils/ids'

interface PendingRating {
  draftId: string
  key: string
  body: RatingRequest
}

export interface RatingFailure {
  error: ApiError
  canRetry: boolean
  retryReadyAt: number | null
}

type ForDraft<T> = { draftId: string; value: T } | null

export function useDraftDetails(draft: Draft | null, enabled: boolean) {
  const [loaded, setLoaded] = useState<ForDraft<DraftDetails>>(null)
  const [loadError, setLoadError] = useState<ForDraft<ApiError>>(null)
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingFailure, setRatingFailure] = useState<ForDraft<RatingFailure>>(null)
  const [savedFor, setSavedFor] = useState<string | null>(null)

  const currentDraftId = useRef<string | null>(null)
  const pending = useRef<PendingRating | null>(null)
  const busyRef = useRef(false)

  const draftId = draft?.draft_id ?? null
  const revision = draft?.revision ?? null
  const status = draft?.status ?? null

  const load = useCallback(async (id: string) => {
    try {
      const res = await getDraftDetails(id)
      setLoaded({ draftId: id, value: res.data })
      setLoadError(null)
    } catch (e) {
      setLoadError({ draftId: id, value: toApiError(e) })
    }
  }, [])

  // Load on a new draft, and reload when its revision or status changes.
  useEffect(() => {
    if (currentDraftId.current !== draftId) {
      currentDraftId.current = draftId
      pending.current = null
    }
    // Data fetching: state is only set after the request resolves, not synchronously.
    // oxlint-disable-next-line react/set-state-in-effect
    if (enabled && draftId !== null) void load(draftId)
  }, [enabled, draftId, revision, status, load])

  async function runRating(action: PendingRating) {
    busyRef.current = true
    setRatingBusy(true)
    setRatingFailure(null)
    setSavedFor(null)
    pending.current = action
    try {
      await submitRating(action.draftId, action.body, action.key)
      pending.current = null
      setSavedFor(`${action.draftId}:${action.body.expected_revision}`)
      await load(action.draftId)
    } catch (e) {
      const err = toApiError(e)
      const canRetry = err.retryable || err.code === 'UNAUTHORIZED'
      if (!canRetry) pending.current = null
      setRatingFailure({
        draftId: action.draftId,
        value: {
          error: err,
          canRetry,
          retryReadyAt: err.retryAfterSeconds !== null ? Date.now() + err.retryAfterSeconds * 1000 : null,
        },
      })
    } finally {
      busyRef.current = false
      setRatingBusy(false)
    }
  }

  function rate(body: RatingRequest) {
    if (draftId === null || busyRef.current) return
    void runRating({ draftId, key: newIdempotencyKey('rating'), body })
  }

  function retryRating() {
    if (pending.current === null || busyRef.current) return
    void runRating(pending.current)
  }

  function dismissRatingFailure() {
    pending.current = null
    setRatingFailure(null)
  }

  const mine = <T,>(entry: ForDraft<T>): T | null => (entry !== null && entry.draftId === draftId ? entry.value : null)

  return {
    details: enabled ? mine(loaded) : null,
    error: enabled ? mine(loadError) : null,
    reload: () => {
      if (draftId !== null) void load(draftId)
    },
    rate,
    ratingBusy,
    ratingFailure: mine(ratingFailure),
    // Only for the revision that was just rated, not later revisions.
    ratingSaved: savedFor !== null && savedFor === `${draftId}:${revision}`,
    retryRating,
    dismissRatingFailure,
  }
}

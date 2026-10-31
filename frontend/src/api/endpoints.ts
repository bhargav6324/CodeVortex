/**
 * The four authenticated browser operations from the shared contract, plus /health.
 * Screens call these functions; they never call fetch() directly.
 */
import { request, type ApiResponse } from './client'
import type { Context, Draft, DraftRequest, Health, ReviewRequest } from '../types/contract'
import type { DraftDetails, Rating, RatingRequest } from '../types/contractV11'

const id = (value: string) => encodeURIComponent(value)

/** GET /api/v1/customers/{customer_id}/context */
export function getContext(customerId: string): Promise<ApiResponse<Context>> {
  return request<Context>({ method: 'GET', path: `/api/v1/customers/${id(customerId)}/context`, responseSchema: 'Context' })
}

/**
 * POST /api/v1/drafts — runs the full generation pipeline (can take up to ~30 s).
 * 201 = new draft, 200 = replay of the same idempotency key.
 * A business refusal is still a success: the Draft comes back with status "blocked".
 */
export function createDraft(
  customerId: string,
  idempotencyKey: string,
): Promise<ApiResponse<Draft>> {
  const body: DraftRequest = { customer_id: customerId, channel: 'email', locale: 'en-IN' }
  return request<Draft>({
    method: 'POST',
    path: '/api/v1/drafts',
    body,
    idempotencyKey,
    requestSchema: 'DraftRequest',
    responseSchema: 'Draft',
  })
}

/** GET /api/v1/drafts/{draft_id} — reload or recover the persisted draft. */
export function getDraft(draftId: string): Promise<ApiResponse<Draft>> {
  return request<Draft>({ method: 'GET', path: `/api/v1/drafts/${id(draftId)}`, responseSchema: 'Draft' })
}

/**
 * POST /api/v1/drafts/{draft_id}/review — edit, approve or reject.
 * Pass the complete ReviewRequest; build it with the helpers below so the
 * field combinations always match the contract.
 */
export function reviewDraft(
  draftId: string,
  body: ReviewRequest,
  idempotencyKey: string,
): Promise<ApiResponse<Draft>> {
  return request<Draft>({
    method: 'POST',
    path: `/api/v1/drafts/${id(draftId)}/review`,
    body,
    idempotencyKey,
    requestSchema: 'ReviewRequest',
    responseSchema: 'Draft',
  })
}

/** GET /health — unauthenticated backend liveness (only for a status badge). */
export function getHealth(): Promise<ApiResponse<Health>> {
  // HealthV11 accepts contract_version "1.0.0" or "1.1.0".
  return request<Health>({ method: 'GET', path: '/health', responseSchema: 'HealthV11' })
}

// ---------------------------------------------------------------------------
// PROPOSED v1.1.0 additions — only call these when /health reports "1.1.0".
// ---------------------------------------------------------------------------

/** GET /api/v1/drafts/{draft_id}/details — offer eligibility, audit trail, mock outbox row, ratings. */
export function getDraftDetails(draftId: string): Promise<ApiResponse<DraftDetails>> {
  return request<DraftDetails>({ method: 'GET', path: `/api/v1/drafts/${id(draftId)}/details`, responseSchema: 'DraftDetails' })
}

/** POST /api/v1/drafts/{draft_id}/ratings — reviewer rubric for the evaluation report. 201 new, 200 replay. */
export function submitRating(draftId: string, body: RatingRequest, idempotencyKey: string): Promise<ApiResponse<Rating>> {
  return request<Rating>({
    method: 'POST',
    path: `/api/v1/drafts/${id(draftId)}/ratings`,
    body,
    idempotencyKey,
    requestSchema: 'RatingRequest',
    responseSchema: 'Rating',
  })
}

// ---------------------------------------------------------------------------
// ReviewRequest builders — the only valid combinations.
// ---------------------------------------------------------------------------

function cleanFeedback(feedback: string | null | undefined): string | null {
  const trimmed = feedback?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function buildEditRequest(
  expectedRevision: number,
  subject: string,
  body: string,
  feedback?: string | null,
): ReviewRequest {
  return {
    expected_revision: expectedRevision,
    decision: 'edit',
    edited_message: { subject, body },
    feedback: cleanFeedback(feedback),
    delivery: 'draft_only',
  }
}

export function buildApproveRequest(
  expectedRevision: number,
  delivery: 'draft_only' | 'mock_email',
  feedback?: string | null,
): ReviewRequest {
  return {
    expected_revision: expectedRevision,
    decision: 'approve',
    edited_message: null,
    feedback: cleanFeedback(feedback),
    delivery,
  }
}

export function buildRejectRequest(
  expectedRevision: number,
  feedback?: string | null,
): ReviewRequest {
  return {
    expected_revision: expectedRevision,
    decision: 'reject',
    edited_message: null,
    feedback: cleanFeedback(feedback),
    delivery: 'draft_only',
  }
}

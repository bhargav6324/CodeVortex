/**
 * MSW mock of the FastAPI backend, following the shared contract v1.0.0 plus the
 * PROPOSED additive v1.1.0 endpoints (draft details and reviewer ratings), so it reports
 * contract_version "1.1.0". See contracts/PROPOSAL_v1.1.0.md.
 *
 * It reproduces the behaviour the UI must handle: auth errors, strict request
 * validation, idempotency replay/conflict, revision checks, the review state machine,
 * blocked drafts, template-only edits, stale data, timeouts and service outages.
 *
 * Mock tokens (paste in the token box):
 *   any non-empty value -> valid reviewer "reviewer_demo"
 *   "expired"           -> 401 UNAUTHORIZED
 *   "forbidden"         -> 403 FORBIDDEN
 */
import { delay, http, HttpResponse } from 'msw'
import { API_BASE_URL } from '../api/config'
import type {
  Draft,
  DraftRequest,
  ErrorBody,
  ErrorCode,
  Health,
  Message,
  ReviewRequest,
} from '../types/contract'
import type { AuditEvent, AuditEventType, DraftDetails, Rating, RatingRequest } from '../types/contractV11'
import { CONTRACT_V11, RUBRIC_CRITERIA } from '../types/contractV11'
import { attempts, db, inFlight, saveDb, type StoredOutcome } from './db'
import { findScenario, mockEligibility } from './fixtures/scenarios'

/** The mock implements the proposed extension, so it advertises 1.1.0. */
const MOCK_CONTRACT_VERSION = CONTRACT_V11

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const MAX_PUBLIC_BODY_BYTES = 64 * 1024
// Simulated latency so loading states are visible in the browser; none in automated tests.
const GENERATION_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 1200
const READ_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 250

type Details = ErrorBody['error']['details']

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

let mockRequestCounter = 0

function baseHeaders(requestId: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Request-ID': requestId,
    'X-Contract-Version': MOCK_CONTRACT_VERSION,
    'Cache-Control': 'no-store',
    ...extra,
  }
}

function ok<T>(body: T, requestId: string, status = 200, extra: Record<string, string> = {}) {
  return HttpResponse.json(body as never, { status, headers: baseHeaders(requestId, extra) })
}

class MockHttpError {
  readonly status: number
  readonly code: ErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly details: Details
  readonly retryAfter: number | null

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    opts: { retryable?: boolean; details?: Details; retryAfter?: number } = {},
  ) {
    this.status = status
    this.code = code
    this.message = message
    this.retryable = opts.retryable ?? false
    this.details = opts.details ?? []
    this.retryAfter = opts.retryAfter ?? null
  }
}

function errorBody(err: MockHttpError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      request_id: requestId,
      retryable: err.retryable,
      details: err.details,
    },
  }
}

function errorHeaders(err: MockHttpError): Record<string, string> {
  return err.retryAfter === null ? {} : { 'Retry-After': String(err.retryAfter) }
}

function fail(err: MockHttpError, requestId: string) {
  return HttpResponse.json(errorBody(err, requestId) as never, {
    status: err.status,
    headers: baseHeaders(requestId, errorHeaders(err)),
  })
}

const invalid = (reason: string, field: string | null = null) =>
  new MockHttpError(422, 'INVALID_REQUEST', 'The request does not match the API contract.', {
    details: [{ field, reason }],
  })

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

// ---------------------------------------------------------------------------
// Common request checks
// ---------------------------------------------------------------------------

function resolveRequestId(request: Request): string {
  const header = request.headers.get('X-Request-ID')
  if (header === null) return `REQ_mock_${++mockRequestCounter}`
  if (!ID_PATTERN.test(header)) {
    throw invalid('X-Request-ID must match ^[A-Za-z0-9_-]{1,64}$', 'X-Request-ID')
  }
  return header
}

/** Returns the actor ID for a valid reviewer token. */
function authenticate(request: Request): string {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  const token = match?.[1].trim() ?? ''
  if (token === '' || token === 'expired') {
    throw new MockHttpError(401, 'UNAUTHORIZED', 'Missing, expired or invalid reviewer token.')
  }
  if (token === 'forbidden') {
    throw new MockHttpError(403, 'FORBIDDEN', 'This reviewer is not allowed to perform this action.')
  }
  return 'reviewer_demo'
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key')
  if (key === null) throw invalid('Idempotency-Key header is required on POST requests.', 'Idempotency-Key')
  if (!ID_PATTERN.test(key)) {
    throw invalid('Idempotency-Key must match ^[A-Za-z0-9_-]{1,64}$', 'Idempotency-Key')
  }
  return key
}

async function readJsonBody(request: Request): Promise<{ value: unknown; raw: string }> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_PUBLIC_BODY_BYTES) {
    throw invalid('Request body exceeds 64 KiB.')
  }
  try {
    return { value: JSON.parse(raw), raw }
  } catch {
    throw invalid('Malformed JSON body.')
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Closed objects: every listed key required, no unknown keys. */
function requireExactKeys(value: unknown, keys: string[], where: string): Record<string, unknown> {
  if (!isObject(value)) throw invalid(`${where} must be a JSON object.`, where)
  for (const key of keys) {
    if (!(key in value)) throw invalid(`Missing required field "${key}".`, `${where}.${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw invalid(`Unknown field "${key}".`, `${where}.${key}`)
  }
  return value
}

function validateDraftRequest(value: unknown): DraftRequest {
  const body = requireExactKeys(value, ['customer_id', 'channel', 'locale'], 'body')
  if (typeof body.customer_id !== 'string' || !ID_PATTERN.test(body.customer_id)) {
    throw invalid('customer_id must be an ID.', 'customer_id')
  }
  if (body.channel !== 'email') throw invalid('channel must be "email".', 'channel')
  if (body.locale !== 'en-IN') throw invalid('locale must be "en-IN".', 'locale')
  return body as unknown as DraftRequest
}

function validateMessage(value: unknown, where: string): Message {
  const msg = requireExactKeys(value, ['subject', 'body'], where)
  if (typeof msg.subject !== 'string' || msg.subject.length < 1 || msg.subject.length > 160) {
    throw invalid('subject must be 1–160 characters.', `${where}.subject`)
  }
  if (typeof msg.body !== 'string' || msg.body.length < 1 || msg.body.length > 5000) {
    throw invalid('body must be 1–5000 characters.', `${where}.body`)
  }
  return msg as unknown as Message
}

function validateReviewRequest(value: unknown): ReviewRequest {
  const body = requireExactKeys(
    value,
    ['expected_revision', 'decision', 'edited_message', 'feedback', 'delivery'],
    'body',
  )
  if (!Number.isInteger(body.expected_revision) || (body.expected_revision as number) < 1) {
    throw invalid('expected_revision must be an integer >= 1.', 'expected_revision')
  }
  if (body.decision !== 'edit' && body.decision !== 'approve' && body.decision !== 'reject') {
    throw invalid('decision must be edit, approve or reject.', 'decision')
  }
  if (body.delivery !== 'draft_only' && body.delivery !== 'mock_email') {
    throw invalid('delivery must be draft_only or mock_email.', 'delivery')
  }
  if (body.feedback !== null) {
    if (typeof body.feedback !== 'string' || body.feedback.length < 1 || body.feedback.length > 1000) {
      throw invalid('feedback must be null or 1–1000 characters.', 'feedback')
    }
  }
  if (body.edited_message !== null) validateMessage(body.edited_message, 'edited_message')

  // Strict combinations from the contract.
  if (body.decision === 'edit') {
    if (body.edited_message === null) throw invalid('edit requires edited_message.', 'edited_message')
    if (body.delivery !== 'draft_only') throw invalid('edit requires delivery=draft_only.', 'delivery')
  } else if (body.edited_message !== null) {
    throw invalid(`${body.decision} requires edited_message=null.`, 'edited_message')
  }
  if (body.decision === 'reject' && body.delivery !== 'draft_only') {
    throw invalid('reject requires delivery=draft_only.', 'delivery')
  }
  return body as unknown as ReviewRequest
}

// ---------------------------------------------------------------------------
// Idempotency: same key + same body -> replay; same key + changed body -> 409.
// ---------------------------------------------------------------------------

function replayOrConflict(scope: string, bodyHash: string, requestId: string) {
  const stored = db.idempotency[scope]
  if (stored === undefined) return null
  if (stored.bodyHash !== bodyHash) {
    return fail(
      new MockHttpError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different body.'),
      requestId,
    )
  }
  // A replayed draft creation is returned as 200 instead of 201; stored errors keep their status.
  const status = stored.status === 201 ? 200 : stored.status
  return HttpResponse.json(stored.body as never, {
    status,
    headers: baseHeaders(requestId, stored.headers),
  })
}

function remember(scope: string, outcome: StoredOutcome): void {
  db.idempotency[scope] = outcome
  saveDb()
}

function guardInFlight(scope: string): void {
  if (inFlight.has(scope)) {
    throw new MockHttpError(409, 'VERSION_CONFLICT', 'An identical request is still being processed.', {
      retryable: true,
      retryAfter: 1,
    })
  }
}

// ---------------------------------------------------------------------------
// Draft creation
// ---------------------------------------------------------------------------

function buildDraft(customerId: string, requestId: string): { draft: Draft; canonical: Message | null } {
  const scenario = findScenario(customerId)
  if (scenario === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Customer not found.')
  const o = scenario.outcome
  const now = nowIso()
  const draftId = `DRAFT${String(db.nextDraft++).padStart(3, '0')}`
  const blockFindings = o.findings.filter((f) => f.severity === 'block')

  const draft: Draft = {
    draft_id: draftId,
    customer_id: customerId,
    revision: 1,
    status: o.status,
    segments: clone(o.segments),
    strategy: clone(o.strategy),
    selected_offer_id: o.selected_offer_id,
    message: clone(o.message),
    evidence: clone(o.evidence),
    validation: {
      passed: blockFindings.length === 0,
      findings: clone(o.findings),
      checked_at: now,
      validator_version: 'validator_v1',
    },
    versions: {
      policy_version: 'policy_v1',
      template_version: 'templates_v1',
      prompt_version: 'prompt_v1',
      model_version: o.model_version,
      data_version: scenario.context.data_version,
    },
    campaign_key: o.campaign_key,
    created_at: now,
    updated_at: now,
    approved_by: null,
    approved_at: null,
    send_status: 'not_sent',
    delivery_id: null,
    feedback: null,
    request_id: requestId,
  }
  return { draft, canonical: clone(o.message) }
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** v1 grounding rule: only CRLF->LF and outer whitespace trimming are allowed edits. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function applyReview(draft: Draft, review: ReviewRequest, actor: string): Draft {
  if (draft.status === 'approved' || draft.status === 'rejected' || draft.status === 'mock_sent') {
    throw new MockHttpError(409, 'INVALID_TRANSITION', `This draft is already ${draft.status}; no further review is possible.`)
  }
  if (review.expected_revision !== draft.revision) {
    throw new MockHttpError(
      409,
      'VERSION_CONFLICT',
      `The draft is at revision ${draft.revision}, not ${review.expected_revision}. Reload and review the latest content.`,
      { details: [{ field: 'expected_revision', reason: 'STALE_REVISION' }] },
    )
  }

  const now = nowIso()
  const blockDetails: Details = draft.validation.findings
    .filter((f) => f.severity === 'block')
    .map((f) => ({ field: f.field, reason: f.code }))

  if (review.decision === 'reject') {
    return { ...draft, revision: draft.revision + 1, status: 'rejected', send_status: 'not_sent', feedback: review.feedback, updated_at: now }
  }

  if (review.decision === 'edit') {
    const canonical = db.canonical[draft.draft_id] ?? null
    if (draft.status === 'blocked' || canonical === null) {
      throw new MockHttpError(422, 'REVIEW_BLOCKED', 'This draft is blocked; editing cannot bypass its checks. Generate a new draft once the data allows it.', {
        details: blockDetails.length > 0 ? blockDetails : [{ field: 'message', reason: 'POLICY_MISMATCH' }],
      })
    }
    const edited = review.edited_message as Message
    const subject = normalize(edited.subject)
    const body = normalize(edited.body)
    const details: Details = []
    if (subject !== normalize(canonical.subject)) details.push({ field: 'edited_message.subject', reason: 'POLICY_MISMATCH' })
    if (body !== normalize(canonical.body)) details.push({ field: 'edited_message.body', reason: 'UNSUPPORTED_CLAIM' })
    if (details.length > 0) {
      throw new MockHttpError(
        422,
        'REVIEW_BLOCKED',
        'Only formatting fixes are allowed in v1. The text must match the approved template wording.',
        { details },
      )
    }
    return {
      ...draft,
      revision: draft.revision + 1,
      status: 'ready_for_review',
      message: { subject, body },
      validation: { ...draft.validation, checked_at: now },
      feedback: review.feedback,
      updated_at: now,
    }
  }

  // approve
  if (draft.status === 'blocked') {
    throw new MockHttpError(422, 'REVIEW_BLOCKED', 'A blocked draft cannot be approved. Nothing was sent.', {
      details: blockDetails,
    })
  }
  if (findScenario(draft.customer_id)?.behavior === 'stale_on_approve') {
    throw new MockHttpError(
      409,
      'VERSION_CONFLICT',
      'Customer data changed since this draft was generated. Generate a new draft.',
      { details: [{ field: 'versions.data_version', reason: 'STALE_SNAPSHOT' }] },
    )
  }

  const approved: Draft = {
    ...draft,
    revision: draft.revision + 1,
    approved_by: actor,
    approved_at: now,
    feedback: review.feedback,
    updated_at: now,
    validation: { ...draft.validation, checked_at: now },
  }
  if (review.delivery === 'mock_email') {
    // One outbox row per draft, ever.
    db.outbox[draft.draft_id] = (db.outbox[draft.draft_id] ?? 0) + 1
    return {
      ...approved,
      status: 'mock_sent',
      send_status: 'mock_sent',
      delivery_id: `DELIVERY${String(db.nextDelivery++).padStart(3, '0')}`,
    }
  }
  return { ...approved, status: 'approved', send_status: 'draft_only' }
}

// ---------------------------------------------------------------------------
// Proposed v1.1.0: audit trail, mock outbox rows, ratings
// ---------------------------------------------------------------------------

function recordEvent(draft: Draft, type: AuditEventType, actor: string, requestId: string, summary: string): void {
  const event: AuditEvent = {
    event_id: `EVT${String(db.nextEvent++).padStart(4, '0')}`,
    draft_id: draft.draft_id,
    revision: draft.revision,
    event_type: type,
    actor_id: actor,
    request_id: requestId,
    at: nowIso(),
    summary,
    evidence_fields: draft.evidence.map((e) => e.field),
  }
  ;(db.audit[draft.draft_id] ??= []).push(event)
  saveDb()
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Writes the single mock outbox row for a mock_sent draft (no real email). */
async function writeOutbox(draft: Draft): Promise<void> {
  if (draft.message === null || draft.delivery_id === null || db.outboxEntries[draft.draft_id]) return
  const { subject, body } = draft.message
  db.outboxEntries[draft.draft_id] = {
    delivery_id: draft.delivery_id,
    draft_id: draft.draft_id,
    customer_id: draft.customer_id,
    campaign_key: draft.campaign_key,
    channel: 'email',
    delivery: 'mock_email',
    subject,
    body,
    content_hash: await sha256Hex(`${draft.customer_id}\n${subject}\n${body}`),
    delivered_at: draft.approved_at ?? nowIso(),
  }
  saveDb()
}

function reviewEventType(updated: Draft, decision: ReviewRequest['decision']): AuditEventType {
  if (decision === 'edit') return 'edited'
  if (decision === 'reject') return 'rejected'
  return updated.status === 'mock_sent' ? 'mock_sent' : 'approved'
}

function validateRatingRequest(value: unknown): RatingRequest {
  const body = requireExactKeys(value, ['expected_revision', ...RUBRIC_CRITERIA, 'comment'], 'body')
  if (!Number.isInteger(body.expected_revision) || (body.expected_revision as number) < 1) {
    throw invalid('expected_revision must be an integer >= 1.', 'expected_revision')
  }
  for (const c of RUBRIC_CRITERIA) {
    const v = body[c]
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5) throw invalid(`${c} must be an integer 1–5.`, c)
  }
  if (body.comment !== null && (typeof body.comment !== 'string' || body.comment.length < 1 || body.comment.length > 1000)) {
    throw invalid('comment must be null or 1–1000 characters.', 'comment')
  }
  return body as unknown as RatingRequest
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const url = (path: string) => `${API_BASE_URL}${path}`

export const handlers = [
  http.get(url('/health'), ({ request }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    try {
      requestId = resolveRequestId(request)
      const body: Health = { status: 'ok', service: 'backend', contract_version: MOCK_CONTRACT_VERSION }
      return ok(body, requestId)
    } catch (e) {
      if (e instanceof MockHttpError) return fail(e, requestId)
      throw e
    }
  }),

  http.get(url('/api/v1/customers/:customerId/context'), async ({ request, params }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    try {
      requestId = resolveRequestId(request)
      authenticate(request)
      await delay(READ_DELAY_MS)
      const scenario = findScenario(String(params.customerId))
      if (scenario === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Customer not found.')
      return ok(clone(scenario.context), requestId)
    } catch (e) {
      if (e instanceof MockHttpError) return fail(e, requestId)
      throw e
    }
  }),

  http.post(url('/api/v1/drafts'), async ({ request }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    let scope: string | null = null
    let raw = ''
    try {
      requestId = resolveRequestId(request)
      const actor = authenticate(request)
      const key = requireIdempotencyKey(request)
      const parsed = await readJsonBody(request)
      raw = parsed.raw
      const body = validateDraftRequest(parsed.value)

      scope = `${actor}|POST|/api/v1/drafts|${key}`
      const replay = replayOrConflict(scope, raw, requestId)
      if (replay) return replay
      guardInFlight(scope)
      inFlight.add(scope)

      const scenario = findScenario(body.customer_id)
      await delay(GENERATION_DELAY_MS)

      if (scenario?.behavior === 'service_unavailable') {
        throw new MockHttpError(503, 'SERVICE_UNAVAILABLE', 'The AI service is unavailable. No draft was created.', {
          retryable: true,
          retryAfter: 5,
        })
      }
      if (scenario?.behavior === 'timeout_first_attempt') {
        const n = (attempts.get(scope) ?? 0) + 1
        attempts.set(scope, n)
        if (n === 1) {
          throw new MockHttpError(504, 'AI_TIMEOUT', 'Generation exceeded the time budget. Retry with the same key.', {
            retryable: true,
          })
        }
      }

      const { draft, canonical } = buildDraft(body.customer_id, requestId)
      db.drafts[draft.draft_id] = draft
      db.canonical[draft.draft_id] = canonical
      recordEvent(
        draft,
        draft.status === 'blocked' ? 'draft_blocked' : 'draft_created',
        actor,
        requestId,
        draft.status === 'blocked'
          ? `Generation refused: ${draft.validation.findings.filter((f) => f.severity === 'block').map((f) => f.code).join(', ')}`
          : `Draft generated with ${draft.strategy?.template_id ?? 'no template'}`,
      )
      remember(scope, { bodyHash: raw, status: 201, body: draft })
      return ok(draft, requestId, 201)
    } catch (e) {
      if (e instanceof MockHttpError) {
        // Final 4xx outcomes are remembered for the key; transient 5xx are not (the key is released).
        if (scope !== null && e.status < 500 && e.code !== 'VERSION_CONFLICT' && e.code !== 'IDEMPOTENCY_CONFLICT') {
          remember(scope, { bodyHash: raw, status: e.status, body: errorBody(e, requestId), headers: errorHeaders(e) })
        }
        return fail(e, requestId)
      }
      throw e
    } finally {
      if (scope !== null) inFlight.delete(scope)
    }
  }),

  http.get(url('/api/v1/drafts/:draftId'), async ({ request, params }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    try {
      requestId = resolveRequestId(request)
      authenticate(request)
      await delay(READ_DELAY_MS)
      const draft = db.drafts[String(params.draftId)]
      if (draft === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Draft not found.')
      return ok(clone(draft), requestId)
    } catch (e) {
      if (e instanceof MockHttpError) return fail(e, requestId)
      throw e
    }
  }),

  http.post(url('/api/v1/drafts/:draftId/review'), async ({ request, params }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    let scope: string | null = null
    let raw = ''
    try {
      requestId = resolveRequestId(request)
      const actor = authenticate(request)
      const key = requireIdempotencyKey(request)
      const parsed = await readJsonBody(request)
      raw = parsed.raw
      const review = validateReviewRequest(parsed.value)
      const draftId = String(params.draftId)

      scope = `${actor}|POST|/api/v1/drafts/${draftId}/review|${key}`
      const replay = replayOrConflict(scope, raw, requestId)
      if (replay) return replay
      guardInFlight(scope)
      inFlight.add(scope)

      await delay(READ_DELAY_MS)
      const draft = db.drafts[draftId]
      if (draft === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Draft not found.')

      // A refused review throws here and writes nothing, not even an audit event.
      const updated = applyReview(draft, review, actor)
      db.drafts[draftId] = updated
      if (updated.status === 'mock_sent') await writeOutbox(updated)
      recordEvent(updated, reviewEventType(updated, review.decision), actor, requestId, `Review decision: ${review.decision} (${updated.status})`)
      remember(scope, { bodyHash: raw, status: 200, body: updated })
      return ok(clone(updated), requestId)
    } catch (e) {
      if (e instanceof MockHttpError) {
        const isFinal4xx =
          e.status < 500 && e.code !== 'IDEMPOTENCY_CONFLICT' && !(e.code === 'VERSION_CONFLICT' && e.retryable)
        if (scope !== null && isFinal4xx) {
          remember(scope, { bodyHash: raw, status: e.status, body: errorBody(e, requestId), headers: errorHeaders(e) })
        }
        return fail(e, requestId)
      }
      throw e
    } finally {
      if (scope !== null) inFlight.delete(scope)
    }
  }),

  // ----- Proposed v1.1.0 -----

  http.get(url('/api/v1/drafts/:draftId/details'), async ({ request, params }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    try {
      requestId = resolveRequestId(request)
      authenticate(request)
      await delay(READ_DELAY_MS)
      const draft = db.drafts[String(params.draftId)]
      if (draft === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Draft not found.')
      const scenario = findScenario(draft.customer_id)
      const details: DraftDetails = {
        draft_id: draft.draft_id,
        revision: draft.revision,
        eligibility: scenario ? mockEligibility(scenario.context) : [],
        audit: clone(db.audit[draft.draft_id] ?? []),
        outbox: clone(db.outboxEntries[draft.draft_id] ?? null),
        ratings: clone(db.ratings[draft.draft_id] ?? []),
      }
      return ok(details, requestId)
    } catch (e) {
      if (e instanceof MockHttpError) return fail(e, requestId)
      throw e
    }
  }),

  http.post(url('/api/v1/drafts/:draftId/ratings'), async ({ request, params }) => {
    let requestId = `REQ_mock_${++mockRequestCounter}`
    let scope: string | null = null
    let raw = ''
    try {
      requestId = resolveRequestId(request)
      const actor = authenticate(request)
      const key = requireIdempotencyKey(request)
      const parsed = await readJsonBody(request)
      raw = parsed.raw
      const body = validateRatingRequest(parsed.value)
      const draftId = String(params.draftId)

      scope = `${actor}|POST|/api/v1/drafts/${draftId}/ratings|${key}`
      const replay = replayOrConflict(scope, raw, requestId)
      if (replay) return replay
      guardInFlight(scope)
      inFlight.add(scope)

      await delay(READ_DELAY_MS)
      const draft = db.drafts[draftId]
      if (draft === undefined) throw new MockHttpError(404, 'NOT_FOUND', 'Draft not found.')
      if (draft.message === null) throw invalid('This draft has no message to rate.', 'message')
      if (body.expected_revision !== draft.revision) {
        throw new MockHttpError(409, 'VERSION_CONFLICT', `The draft is at revision ${draft.revision}. Reload and rate the latest content.`, {
          details: [{ field: 'expected_revision', reason: 'STALE_REVISION' }],
        })
      }
      const existing = db.ratings[draftId] ?? []
      if (existing.some((r) => r.rated_by === actor && r.revision === draft.revision)) {
        throw new MockHttpError(409, 'INVALID_TRANSITION', 'You have already rated this revision.')
      }

      const rating: Rating = {
        rating_id: `RATING${String(db.nextRating++).padStart(3, '0')}`,
        draft_id: draftId,
        revision: draft.revision,
        rated_by: actor,
        rated_at: nowIso(),
        relevance: body.relevance,
        clarity: body.clarity,
        personalization: body.personalization,
        call_to_action: body.call_to_action,
        tone: body.tone,
        comment: body.comment,
      }
      db.ratings[draftId] = [...existing, rating]
      recordEvent(draft, 'rated', actor, requestId, 'Reviewer rubric recorded')
      remember(scope, { bodyHash: raw, status: 201, body: rating })
      return ok(rating, requestId, 201)
    } catch (e) {
      if (e instanceof MockHttpError) {
        const isFinal4xx =
          e.status < 500 && e.code !== 'IDEMPOTENCY_CONFLICT' && !(e.code === 'VERSION_CONFLICT' && e.retryable)
        if (scope !== null && isFinal4xx) {
          remember(scope, { bodyHash: raw, status: e.status, body: errorBody(e, requestId), headers: errorHeaders(e) })
        }
        return fail(e, requestId)
      }
      throw e
    } finally {
      if (scope !== null) inFlight.delete(scope)
    }
  }),
]

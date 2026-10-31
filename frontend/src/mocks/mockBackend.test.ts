/**
 * The mock backend must (1) return JSON that matches the frozen contract schema and
 * (2) behave like the contract says. If these pass, swapping in the real backend should
 * change nothing in the UI — any difference there is a backend contract bug.
 */
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { request, setAuthToken } from '../api/client'
import { contractErrors, type SchemaName } from '../api/contractCheck'
import {
  buildApproveRequest,
  buildEditRequest,
  buildRejectRequest,
  createDraft,
  getContext,
  getDraft,
  getDraftDetails,
  getHealth,
  reviewDraft,
  submitRating,
} from '../api/endpoints'
import type { RatingRequest } from '../types/contractV11'
import { ApiError } from '../api/errors'
import { customersFor } from '../config/customers'
import { db, resetMockDb } from './db'
import { SCENARIOS } from './fixtures/scenarios'
import { handlers } from './handlers'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  resetMockDb()
  setAuthToken('demo-token')
})

let keyCounter = 0
const key = (prefix: string) => `${prefix}_test_${++keyCounter}`

function expectSchema(name: SchemaName, data: unknown) {
  expect(contractErrors(name, data), `${name} schema errors`).toEqual([])
}

async function expectError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
  throw new Error('Expected the request to fail')
}

const CONTRACT_EXAMPLE_BODY =
  'Hello Asha,\nThank you for being with us for 18 months. You are eligible for our Loyalty reward: INR 100 reward voucher. Valid for one redemption. No cash alternative. Offer expires 2026-11-30.\nTerms apply. This is a draft for human review.\nContact support for questions or billing disputes.'

describe('contract schema conformance', () => {
  it('health matches HealthV11 and advertises the proposed 1.1.0', async () => {
    const res = await getHealth()
    expectSchema('HealthV11', res.data)
    expect(res.data.contract_version).toBe('1.1.0')
    expect(res.contractVersion).toBe('1.1.0')
  })

  it('real-backend mode offers exactly C001–C050 and no mock-only customers', () => {
    const ids = customersFor(false).map((c) => c.id)
    expect(ids).toHaveLength(50)
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 50 }, (_, i) => `C${String(i + 1).padStart(3, '0')}`)))
  })

  it('every customer offered in mock mode has a mock fixture', () => {
    const ids = new Set(SCENARIOS.map((s) => s.customerId))
    for (const c of customersFor(true)) expect(ids.has(c.id), c.id).toBe(true)
  })

  for (const scenario of SCENARIOS.filter((s) => s.behavior !== 'service_unavailable')) {
    it(`${scenario.customerId} (${scenario.fixture}): context and draft match the schema`, async () => {
      expectSchema('Context', (await getContext(scenario.customerId)).data)

      const k = key('create')
      let created
      try {
        created = await createDraft(scenario.customerId, k)
      } catch (e) {
        // The timeout scenario fails once, then succeeds with the same key.
        expect(e).toBeInstanceOf(ApiError)
        created = await createDraft(scenario.customerId, k)
      }
      expectSchema('Draft', created.data)
      expect(created.data.status).toBe(scenario.outcome.status)
      // validation.passed is true exactly when there are no block findings.
      expect(created.data.validation.passed).toBe(!created.data.validation.findings.some((f) => f.severity === 'block'))
    })
  }

  it('error bodies match Error', async () => {
    setAuthToken(null)
    const e = await expectError(getContext('C004'))
    expect(e.status).toBe(401)
    const raw = await fetch('http://backend.test/api/v1/customers/C004/context')
    expectSchema('Error', await raw.json())
  })

  it('review responses match Draft', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    const approved = await reviewDraft(draft.draft_id, buildApproveRequest(1, 'mock_email', 'ok'), key('review'))
    expectSchema('Draft', approved.data)
  })
})

describe('mock backend behaviour', () => {
  it('creates the contract example draft for C004', async () => {
    const res = await createDraft('C004', key('create'))
    expect(res.status).toBe(201)
    expect(res.data.message?.body).toBe(CONTRACT_EXAMPLE_BODY)
    expect(res.data.segments.map((s) => s.code)).toEqual(['loyalty_candidate', 'consistent'])
    expect(res.data.strategy?.objective).toBe('reward')
    expect(res.data.approved_by).toBeNull()
    expect(res.data.send_status).toBe('not_sent')
  })

  it('replays the same key as 200 and rejects a changed body with 409', async () => {
    const k = key('create')
    const first = await createDraft('C004', k)
    const replay = await createDraft('C004', k)
    expect(replay.status).toBe(200)
    expect(replay.data.draft_id).toBe(first.data.draft_id)
    const conflict = await expectError(createDraft('C001', k))
    expect([conflict.status, conflict.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT'])
  })

  it('refuses wording edits (422) without changing the revision, accepts formatting edits', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    const refused = await expectError(
      reviewDraft(draft.draft_id, buildEditRequest(1, draft.message!.subject, CONTRACT_EXAMPLE_BODY + ' Win INR 999!'), key('review')),
    )
    expect(refused.code).toBe('REVIEW_BLOCKED')
    expect((await getDraft(draft.draft_id)).data.revision).toBe(1)

    const edited = await reviewDraft(
      draft.draft_id,
      buildEditRequest(1, draft.message!.subject, `  ${CONTRACT_EXAMPLE_BODY.replace(/\n/g, '\r\n')}\n`),
      key('review'),
    )
    expect(edited.data.revision).toBe(2)
    expect(edited.data.message?.body).toBe(CONTRACT_EXAMPLE_BODY)
  })

  it('approve + mock_email is sent once, replays safely, then is final', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    const stale = await expectError(reviewDraft(draft.draft_id, buildApproveRequest(2, 'draft_only'), key('review')))
    expect([stale.code, stale.retryable]).toEqual(['VERSION_CONFLICT', false])

    const k = key('review')
    const sent = await reviewDraft(draft.draft_id, buildApproveRequest(1, 'mock_email', 'Verified'), k)
    expect(sent.data).toMatchObject({ status: 'mock_sent', send_status: 'mock_sent', revision: 2, approved_by: 'reviewer_demo' })
    expect(sent.data.delivery_id).not.toBeNull()

    const replay = await reviewDraft(draft.draft_id, buildApproveRequest(1, 'mock_email', 'Verified'), k)
    expect(replay.data.delivery_id).toBe(sent.data.delivery_id)
    expect(db.outbox[draft.draft_id]).toBe(1)

    const final = await expectError(reviewDraft(draft.draft_id, buildRejectRequest(2), key('review')))
    expect(final.code).toBe('INVALID_TRANSITION')
  })

  it('draft_only approval sends nothing', async () => {
    const draft = (await createDraft('C001', key('create'))).data
    const approved = await reviewDraft(draft.draft_id, buildApproveRequest(1, 'draft_only'), key('review'))
    expect(approved.data).toMatchObject({ status: 'approved', send_status: 'draft_only', delivery_id: null })
    expect(db.outbox[draft.draft_id]).toBeUndefined()
  })

  it('blocked drafts cannot be approved but can be rejected', async () => {
    const draft = (await createDraft('C007', key('create'))).data
    expect(draft).toMatchObject({ status: 'blocked', message: null })
    const blocked = await expectError(reviewDraft(draft.draft_id, buildApproveRequest(1, 'draft_only'), key('review')))
    expect(blocked.code).toBe('REVIEW_BLOCKED')
    const rejected = await reviewDraft(draft.draft_id, buildRejectRequest(1, 'Consent missing'), key('review'))
    expect(rejected.data).toMatchObject({ status: 'rejected', revision: 2, send_status: 'not_sent' })
  })

  it('stale data on approval returns 409 and sends nothing', async () => {
    const draft = (await createDraft('MOCK_STALE', key('create'))).data
    const e = await expectError(reviewDraft(draft.draft_id, buildApproveRequest(1, 'mock_email'), key('review')))
    expect(e.code).toBe('VERSION_CONFLICT')
    expect(db.outbox[draft.draft_id]).toBeUndefined()
  })

  it('AI timeout then retry with the same key succeeds; AI outage is 503 with Retry-After', async () => {
    const k = key('create')
    const timeout = await expectError(createDraft('MOCK_AI_TIMEOUT', k))
    expect([timeout.status, timeout.code, timeout.retryable]).toEqual([504, 'AI_TIMEOUT', true])
    expect((await createDraft('MOCK_AI_TIMEOUT', k)).status).toBe(201)

    const down = await expectError(createDraft('MOCK_AI_DOWN', key('create')))
    expect([down.status, down.code, down.retryAfterSeconds]).toEqual([503, 'SERVICE_UNAVAILABLE', 5])
  })

  it('rejects contract violations with 422 INVALID_REQUEST', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    const combo = await expectError(
      request({
        method: 'POST',
        path: `/api/v1/drafts/${draft.draft_id}/review`,
        idempotencyKey: key('review'),
        body: { expected_revision: 1, decision: 'reject', edited_message: null, feedback: null, delivery: 'mock_email' },
      }),
    )
    expect(combo.code).toBe('INVALID_REQUEST')

    const noKey = await expectError(
      request({ method: 'POST', path: '/api/v1/drafts', body: { customer_id: 'C004', channel: 'email', locale: 'en-IN' } }),
    )
    expect(noKey.code).toBe('INVALID_REQUEST')
  })

  it('auth: missing token 401, forbidden token 403, unknown customer 404', async () => {
    setAuthToken('forbidden')
    expect((await expectError(getContext('C004'))).code).toBe('FORBIDDEN')
    setAuthToken('demo')
    expect((await expectError(getContext('C999'))).code).toBe('NOT_FOUND')
  })
})

describe('proposed v1.1.0: draft details and ratings', () => {
  const ratingBody = (expected: number, overrides: Partial<RatingRequest> = {}): RatingRequest => ({
    expected_revision: expected,
    relevance: 4,
    clarity: 5,
    personalization: 3,
    call_to_action: 4,
    tone: 5,
    comment: null,
    ...overrides,
  })

  for (const scenario of SCENARIOS.filter((s) => !s.behavior)) {
    it(`${scenario.customerId}: details match DraftDetails`, async () => {
      const draft = (await createDraft(scenario.customerId, key('create'))).data
      const details = (await getDraftDetails(draft.draft_id)).data
      expectSchema('DraftDetails', details)
      expect(details.audit.map((e) => e.event_type)).toEqual([draft.status === 'blocked' ? 'draft_blocked' : 'draft_created'])
      expect(details.outbox).toBeNull()
      // The selected offer must always be one the backend found eligible.
      if (draft.selected_offer_id !== null) {
        expect(details.eligibility.find((e) => e.offer_id === draft.selected_offer_id)?.eligible).toBe(true)
      }
    })
  }

  it('expired offer and missing consent show the right eligibility reasons', async () => {
    const expired = (await createDraft('MOCK_EXPIRED_OFFER', key('create'))).data
    expect((await getDraftDetails(expired.draft_id)).data.eligibility[0]).toEqual({
      offer_id: 'OFFER100',
      eligible: false,
      reason_codes: ['OFFER_NOT_ACTIVE'],
    })
    const noConsent = (await createDraft('C007', key('create'))).data
    expect((await getDraftDetails(noConsent.draft_id)).data.eligibility[0].reason_codes).toEqual(['NO_MARKETING_CONSENT'])
  })

  it('mock_sent writes exactly one outbox row and the audit trail records each step', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    await expectError(reviewDraft(draft.draft_id, buildEditRequest(1, draft.message!.subject, 'changed'), key('review')))
    await reviewDraft(draft.draft_id, buildApproveRequest(1, 'mock_email'), key('review'))
    const details = (await getDraftDetails(draft.draft_id)).data
    expectSchema('DraftDetails', details)
    // The refused edit is not audited: only actions that happened are recorded.
    expect(details.audit.map((e) => e.event_type)).toEqual(['draft_created', 'mock_sent'])
    expect(details.outbox).toMatchObject({ draft_id: draft.draft_id, delivery: 'mock_email', subject: draft.message!.subject })
    expect(details.outbox!.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(details.audit.every((e) => e.evidence_fields.every((f) => !f.includes('Asha')))).toBe(true)
  })

  it('ratings: validated, one per reviewer per revision, replayable, revision unchanged', async () => {
    const draft = (await createDraft('C004', key('create'))).data
    const bad = await expectError(submitRating(draft.draft_id, ratingBody(1, { tone: 6 as never }), key('rating')))
    expect(bad.code).toBe('INVALID_REQUEST')
    const stale = await expectError(submitRating(draft.draft_id, ratingBody(2), key('rating')))
    expect(stale.code).toBe('VERSION_CONFLICT')

    const k = key('rating')
    const created = await submitRating(draft.draft_id, ratingBody(1, { comment: 'Clear and warm' }), k)
    expect(created.status).toBe(201)
    expectSchema('Rating', created.data)
    const replay = await submitRating(draft.draft_id, ratingBody(1, { comment: 'Clear and warm' }), k)
    expect([replay.status, replay.data.rating_id]).toEqual([200, created.data.rating_id])

    const duplicate = await expectError(submitRating(draft.draft_id, ratingBody(1), key('rating')))
    expect(duplicate.code).toBe('INVALID_TRANSITION')
    expect((await getDraft(draft.draft_id)).data.revision).toBe(1)
    expect((await getDraftDetails(draft.draft_id)).data.ratings).toHaveLength(1)
  })

  it('a blocked draft without a message cannot be rated', async () => {
    const draft = (await createDraft('C007', key('create'))).data
    const e = await expectError(submitRating(draft.draft_id, ratingBody(1), key('rating')))
    expect(e.code).toBe('INVALID_REQUEST')
  })
})

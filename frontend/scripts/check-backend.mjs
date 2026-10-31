#!/usr/bin/env node
/**
 * Contract smoke test for the REAL backend (shared contract v1.0.0).
 *
 * PowerShell:
 *   $env:REVIEWER_TOKEN="<token>"; npm run check:backend
 * Git Bash:
 *   REVIEWER_TOKEN=<token> npm run check:backend
 *
 * Optional environment variables:
 *   BACKEND_URL         default: VITE_API_BASE_URL from .env, else http://100.83.115.82:8000
 *   CUSTOMER_ID         default: C007 (blocked "no consent" customer: never calls the AI service,
 *                       so it is safe to run any time). Use C004 or C001 to exercise AI generation.
 *   SECOND_CUSTOMER_ID  default: C001 (used only for the idempotency-conflict check)
 *   SKIP_REVIEW=1       skip the review checks (e.g. backend running in-memory with review disabled)
 *   FRONTEND_ORIGIN     default: http://100.117.73.55:5173 (for the CORS checks)
 *   SKIP_CORS=1         skip the CORS checks
 *
 * Side effects: creates ONE draft for CUSTOMER_ID and then REJECTS it (unless SKIP_REVIEW=1).
 * Nothing is approved or sent, and no mock outbox row is written.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(readFileSync(join(here, '../src/types/contract.schema.json'), 'utf8'))
// PROPOSED v1.1.0 additions; only checked when the backend reports contract_version 1.1.0.
const extSchema = JSON.parse(readFileSync(join(here, '../src/types/contract-v1.1-ext.schema.json'), 'utf8'))
const EXT_NAMES = ['HealthV11', 'RatingRequest', 'Rating', 'DraftDetails']
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
ajv.addSchema(schema)
ajv.addSchema(extSchema)

const newId = (prefix) => `${prefix}_${randomUUID()}`

function schemaProblem(name, data) {
  const id = EXT_NAMES.includes(name) ? extSchema.$id : schema.$id
  const validate = ajv.getSchema(`${id}#/$defs/${name}`)
  return validate(data) ? null : `${name} schema: ${ajv.errorsText(validate.errors)}`
}

/** Runs every check and returns { results, passed, failed }. Never throws. */
export async function runChecks({ baseUrl, token, customerId, secondCustomerId, origin, skipCors = false, skipReview = false }) {
  const results = []
  const base = baseUrl.replace(/\/+$/, '')

  async function call(method, path, { auth = true, body, key, headers = {}, rawBody } = {}) {
    const requestId = newId('REQ')
    const h = { Accept: 'application/json', 'X-Request-ID': requestId, ...headers }
    if (auth && token) h.Authorization = `Bearer ${token}`
    if (key) h['Idempotency-Key'] = key
    if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json'
    const res = await fetch(`${base}${path}`, {
      method,
      headers: h,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(40_000),
    })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, headers: res.headers, json, requestId }
  }

  async function check(name, fn) {
    try {
      const outcome = await fn()
      results.push({ name, ok: outcome === true, detail: outcome === true ? '' : String(outcome) })
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Checks an error response: status, code, Error schema and echoed request ID. */
  function expectError(res, status, code) {
    if (res.status !== status) return `expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.json)}`
    const problem = schemaProblem('Error', res.json)
    if (problem) return problem
    if (res.json.error.code !== code) return `expected code ${code}, got ${res.json.error.code}`
    if (res.headers.get('x-request-id') !== res.requestId) return 'X-Request-ID was not echoed on the error response'
    return true
  }

  // --- Health and headers -------------------------------------------------
  let contractVersion = '1.0.0'
  await check('GET /health returns Health with contract headers', async () => {
    const res = await call('GET', '/health', { auth: false })
    if (res.status !== 200) return `expected 200, got ${res.status}`
    const problem = schemaProblem('HealthV11', res.json)
    if (problem) return problem
    contractVersion = res.json.contract_version
    if (res.headers.get('x-contract-version') !== contractVersion) {
      return `X-Contract-Version is "${res.headers.get('x-contract-version')}" but /health says "${contractVersion}"`
    }
    if (res.headers.get('x-request-id') !== res.requestId) return 'X-Request-ID was not echoed'
    if (!/no-store/i.test(res.headers.get('cache-control') ?? '')) return 'Cache-Control: no-store missing'
    return true
  })

  // --- CORS ---------------------------------------------------------------
  if (!skipCors) {
    await check(`CORS preflight allows ${origin}`, async () => {
      const res = await fetch(`${base}/api/v1/drafts`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,x-request-id',
        },
      })
      const allowOrigin = res.headers.get('access-control-allow-origin')
      if (allowOrigin !== origin) return `Access-Control-Allow-Origin is "${allowOrigin}", expected "${origin}"`
      const allowHeaders = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase()
      const missing = ['authorization', 'content-type', 'idempotency-key', 'x-request-id'].filter(
        (h) => allowHeaders !== '*' && !allowHeaders.includes(h),
      )
      if (missing.length) return `Access-Control-Allow-Headers is missing: ${missing.join(', ')}`
      return true
    })

    await check('CORS exposes X-Request-ID, X-Contract-Version, Retry-After', async () => {
      const res = await fetch(`${base}/health`, { headers: { Origin: origin } })
      const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase()
      const missing = ['x-request-id', 'x-contract-version', 'retry-after'].filter((h) => !exposed.includes(h))
      return missing.length ? `Access-Control-Expose-Headers is missing: ${missing.join(', ')}` : true
    })
  }

  // --- Context --------------------------------------------------------------
  const contextPath = `/api/v1/customers/${encodeURIComponent(customerId)}/context`

  await check('GET context without a token -> 401 UNAUTHORIZED', async () =>
    expectError(await call('GET', contextPath, { auth: false }), 401, 'UNAUTHORIZED'),
  )

  await check(`GET context for ${customerId} returns Context`, async () => {
    const res = await call('GET', contextPath)
    if (res.status !== 200) return `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`
    const problem = schemaProblem('Context', res.json)
    if (problem) return problem
    return res.json.customer.customer_id === customerId ? true : `customer_id is ${res.json.customer.customer_id}`
  })

  await check('GET context for an unknown customer -> 404 NOT_FOUND', async () =>
    expectError(await call('GET', '/api/v1/customers/CUST_DOES_NOT_EXIST/context'), 404, 'NOT_FOUND'),
  )

  // --- Draft creation -------------------------------------------------------
  const createBody = { customer_id: customerId, channel: 'email', locale: 'en-IN' }

  await check('POST /drafts without Idempotency-Key -> 422 INVALID_REQUEST', async () =>
    expectError(await call('POST', '/api/v1/drafts', { body: createBody }), 422, 'INVALID_REQUEST'),
  )

  await check('POST /drafts with an unknown field -> 422 INVALID_REQUEST', async () =>
    expectError(
      await call('POST', '/api/v1/drafts', { body: { ...createBody, extra: true }, key: newId('create') }),
      422,
      'INVALID_REQUEST',
    ),
  )

  const createKey = newId('create')
  let draft = null

  await check('POST /drafts creates a Draft (201)', async () => {
    const res = await call('POST', '/api/v1/drafts', { body: createBody, key: createKey })
    if (res.status !== 201) return `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`
    const problem = schemaProblem('Draft', res.json)
    if (problem) return problem
    draft = res.json
    if (draft.revision !== 1) return `revision is ${draft.revision}, expected 1`
    if (!['ready_for_review', 'blocked'].includes(draft.status)) return `status is ${draft.status}`
    const hasBlock = draft.validation.findings.some((f) => f.severity === 'block')
    if (draft.validation.passed === hasBlock) return 'validation.passed must be true exactly when there are no block findings'
    if (draft.approved_by !== null || draft.delivery_id !== null || draft.send_status !== 'not_sent') {
      return 'a new draft must have approved_by=null, delivery_id=null, send_status=not_sent'
    }
    return true
  })

  if (draft === null) {
    results.push({ name: 'Remaining draft checks', ok: false, detail: 'skipped because draft creation failed' })
    return summarize(results, contractVersion)
  }
  const draftPath = `/api/v1/drafts/${encodeURIComponent(draft.draft_id)}`

  await check('Replaying the same key and body returns 200 with the same draft', async () => {
    const res = await call('POST', '/api/v1/drafts', { body: createBody, key: createKey })
    if (res.status !== 200) return `expected 200, got ${res.status}`
    return res.json?.draft_id === draft.draft_id ? true : `got draft ${res.json?.draft_id}, expected ${draft.draft_id}`
  })

  await check('Same key with a different body -> 409 IDEMPOTENCY_CONFLICT', async () =>
    expectError(
      await call('POST', '/api/v1/drafts', { body: { ...createBody, customer_id: secondCustomerId }, key: createKey }),
      409,
      'IDEMPOTENCY_CONFLICT',
    ),
  )

  await check('GET /drafts/{id} returns the same Draft', async () => {
    const res = await call('GET', draftPath)
    if (res.status !== 200) return `expected 200, got ${res.status}`
    const problem = schemaProblem('Draft', res.json)
    if (problem) return problem
    return res.json.revision === draft.revision ? true : `revision changed on read: ${res.json.revision}`
  })

  // --- Proposed v1.1.0: details and ratings (only if the backend reports 1.1.0) ---
  const v11 = contractVersion === '1.1.0'
  const ratingsPath = `${draftPath}/ratings`
  const rating = (expected, overrides = {}) => ({
    expected_revision: expected,
    relevance: 4,
    clarity: 4,
    personalization: 3,
    call_to_action: 4,
    tone: 5,
    comment: 'Contract smoke test',
    ...overrides,
  })

  if (v11) {
    await check('[v1.1] GET /drafts/{id}/details returns DraftDetails', async () => {
      const res = await call('GET', `${draftPath}/details`)
      if (res.status !== 200) return `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`
      const problem = schemaProblem('DraftDetails', res.json)
      if (problem) return problem
      if (res.json.draft_id !== draft.draft_id || res.json.revision !== draft.revision) return 'draft_id/revision do not match the draft'
      if (!res.json.audit.some((e) => e.event_type === 'draft_created' || e.event_type === 'draft_blocked')) {
        return 'audit has no draft_created / draft_blocked event'
      }
      return res.json.outbox === null ? true : 'outbox must be null for a draft that was not mock-sent'
    })

    if (draft.message !== null) {
      await check('[v1.1] Rating with a score of 6 -> 422 INVALID_REQUEST', async () =>
        expectError(await call('POST', ratingsPath, { body: rating(draft.revision, { tone: 6 }), key: newId('rating') }), 422, 'INVALID_REQUEST'),
      )
      await check('[v1.1] Rating with a stale expected_revision -> 409 VERSION_CONFLICT', async () =>
        expectError(await call('POST', ratingsPath, { body: rating(draft.revision + 5), key: newId('rating') }), 409, 'VERSION_CONFLICT'),
      )
      const ratingKey = newId('rating')
      let ratingId = null
      await check('[v1.1] POST /drafts/{id}/ratings creates a Rating (201) without changing the revision', async () => {
        const res = await call('POST', ratingsPath, { body: rating(draft.revision), key: ratingKey })
        if (res.status !== 201) return `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`
        const problem = schemaProblem('Rating', res.json)
        if (problem) return problem
        ratingId = res.json.rating_id
        if (res.json.revision !== draft.revision) return `rating.revision is ${res.json.revision}`
        const after = await call('GET', draftPath)
        return after.json?.revision === draft.revision ? true : 'rating must not change the draft revision'
      })
      await check('[v1.1] Rating replay with the same key returns 200 and the same rating', async () => {
        const res = await call('POST', ratingsPath, { body: rating(draft.revision), key: ratingKey })
        if (res.status !== 200) return `expected 200, got ${res.status}`
        return res.json?.rating_id === ratingId ? true : `got ${res.json?.rating_id}, expected ${ratingId}`
      })
      await check('[v1.1] Second rating of the same revision -> 409 INVALID_TRANSITION', async () =>
        expectError(await call('POST', ratingsPath, { body: rating(draft.revision), key: newId('rating') }), 409, 'INVALID_TRANSITION'),
      )
    } else {
      results.push({ name: '[v1.1] Rating checks', ok: true, detail: 'skipped: the test draft is blocked (no message)', skipped: true })
    }
  }

  // --- Review ---------------------------------------------------------------
  if (skipReview) {
    results.push({ name: 'Review checks', ok: true, detail: 'skipped (SKIP_REVIEW=1)', skipped: true })
    return summarize(results, contractVersion)
  }
  const reviewPath = `${draftPath}/review`
  const reject = (expected) => ({
    expected_revision: expected,
    decision: 'reject',
    edited_message: null,
    feedback: 'Contract smoke test',
    delivery: 'draft_only',
  })

  await check('Review with a stale expected_revision -> 409 VERSION_CONFLICT', async () =>
    expectError(await call('POST', reviewPath, { body: reject(draft.revision + 5), key: newId('review') }), 409, 'VERSION_CONFLICT'),
  )

  await check('Reject with delivery=mock_email -> 422 INVALID_REQUEST', async () =>
    expectError(
      await call('POST', reviewPath, { body: { ...reject(draft.revision), delivery: 'mock_email' }, key: newId('review') }),
      422,
      'INVALID_REQUEST',
    ),
  )

  await check('Reject the draft -> rejected, revision + 1, nothing sent', async () => {
    const res = await call('POST', reviewPath, { body: reject(draft.revision), key: newId('review') })
    if (res.status !== 200) return `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`
    const problem = schemaProblem('Draft', res.json)
    if (problem) return problem
    const d = res.json
    if (d.status !== 'rejected') return `status is ${d.status}`
    if (d.revision !== draft.revision + 1) return `revision is ${d.revision}, expected ${draft.revision + 1}`
    if (d.send_status !== 'not_sent' || d.delivery_id !== null || d.approved_by !== null) return 'rejected draft must not be sent or approved'
    return true
  })

  await check('Any review of a final draft -> 409 INVALID_TRANSITION', async () =>
    expectError(await call('POST', reviewPath, { body: reject(draft.revision + 1), key: newId('review') }), 409, 'INVALID_TRANSITION'),
  )

  if (v11) {
    await check('[v1.1] Audit trail records the rejection; no outbox row', async () => {
      const res = await call('GET', `${draftPath}/details`)
      const problem = res.status === 200 ? schemaProblem('DraftDetails', res.json) : `expected 200, got ${res.status}`
      if (problem) return problem
      if (!res.json.audit.some((e) => e.event_type === 'rejected')) return 'audit has no "rejected" event'
      return res.json.outbox === null ? true : 'a rejected draft must not have an outbox row'
    })
  }

  return summarize(results, contractVersion)
}

function summarize(results, contractVersion = 'unknown') {
  const failed = results.filter((r) => !r.ok).length
  return { results, passed: results.length - failed, failed, contractVersion }
}

function readDotEnvBaseUrl() {
  const file = resolve(here, '../.env')
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('VITE_API_BASE_URL='))
  return line ? line.slice('VITE_API_BASE_URL='.length).trim() : null
}

async function main() {
  const token = process.env.REVIEWER_TOKEN
  if (!token) {
    console.error('Set REVIEWER_TOKEN first. PowerShell:  $env:REVIEWER_TOKEN="<token>"; npm run check:backend')
    process.exit(2)
  }
  const config = {
    baseUrl: process.env.BACKEND_URL ?? readDotEnvBaseUrl() ?? 'http://100.83.115.82:8000',
    token,
    customerId: process.env.CUSTOMER_ID ?? 'C007',
    secondCustomerId: process.env.SECOND_CUSTOMER_ID ?? 'C001',
    origin: process.env.FRONTEND_ORIGIN ?? 'http://100.117.73.55:5173',
    skipCors: process.env.SKIP_CORS === '1',
    skipReview: process.env.SKIP_REVIEW === '1',
  }
  console.log(`Checking ${config.baseUrl} against contract v1.0.0 (customer ${config.customerId})\n`)
  const { results, passed, failed, contractVersion } = await runChecks(config)
  for (const r of results) {
    const label = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'
    console.log(`${label}  ${r.name}${r.ok && !r.skipped ? '' : `\n      -> ${r.detail}`}`)
  }
  console.log(`\n${passed} passed, ${failed} failed (backend reports contract ${contractVersion})`)
  if (contractVersion === '1.0.0') {
    console.log('The proposed v1.1.0 checks ([v1.1]) were skipped because the backend reports 1.0.0.')
  }
  if (results.some((r) => !r.ok && r.name.startsWith('Reject the draft') && r.detail.includes('503'))) {
    console.log('\nReview returned 503. If the backend is running in-memory (review disabled until SQLite), re-run with SKIP_REVIEW=1.')
  }
  if (results.some((r) => !r.ok && r.name.startsWith('POST /drafts creates') && r.detail.includes('503'))) {
    console.log('\nDraft creation returned 503: the AI service may be down. C007 (blocked) works without the AI service.')
  }
  if (results[0] && /fetch failed|timeout|ECONNREFUSED/i.test(results[0].detail)) {
    console.log('\nThe backend could not be reached. Is it running, bound to 0.0.0.0:8000, and are you on Tailscale?')
  }
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

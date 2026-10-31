/**
 * Runs the backend smoke test against the MSW mock backend. This proves the script's
 * own logic is right, so on integration day any FAIL points at the real backend.
 */
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resetMockDb } from '../src/mocks/db'
import { handlers } from '../src/mocks/handlers'
// @ts-expect-error -- plain JavaScript module without type declarations
import { runChecks } from './check-backend.mjs'

const server = setupServer(...handlers)
beforeAll(() => {
  resetMockDb()
  server.listen({ onUnhandledFrame: 'error' })
})
afterAll(() => server.close())

it('passes every check against the mock backend', async () => {
  const { results, failed, contractVersion } = await runChecks({
    baseUrl: 'http://backend.test',
    token: 'demo-token',
    customerId: 'C004',
    secondCustomerId: 'C001',
    origin: 'http://100.117.73.55:5173',
    skipCors: true, // the in-process mock does not emulate browser CORS
  })
  const failures = results.filter((r: { ok: boolean }) => !r.ok)
  expect(failures).toEqual([])
  expect(failed).toBe(0)
  expect(contractVersion).toBe('1.1.0')
  // 14 v1.0.0 checks (CORS skipped) + 7 proposed v1.1.0 checks
  expect(results.length).toBeGreaterThanOrEqual(21)
})

it('blocked default customer C007 + SKIP_REVIEW passes without review or AI', async () => {
  resetMockDb()
  const { results, failed } = await runChecks({
    baseUrl: 'http://backend.test',
    token: 'demo-token',
    customerId: 'C007',
    secondCustomerId: 'C001',
    origin: 'http://100.117.73.55:5173',
    skipCors: true,
    skipReview: true,
  })
  expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([])
  expect(failed).toBe(0)
  expect(results.some((r: { name: string }) => r.name.startsWith('Reject the draft'))).toBe(false)
})

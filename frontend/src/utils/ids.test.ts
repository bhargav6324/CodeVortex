import { afterEach, describe, expect, it, vi } from 'vitest'
import { newIdempotencyKey, newRequestId } from './ids'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('ids', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('works without crypto.randomUUID (plain-HTTP pages are not a secure context)', () => {
    // Simulate a non-secure page: only getRandomValues exists.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    expect(() => newRequestId()).not.toThrow()
    expect(newRequestId()).toMatch(/^REQ_/)
  })

  it('produces contract-valid, unique UUID v4 based IDs', () => {
    const ids = [newRequestId(), newIdempotencyKey('create'), newIdempotencyKey('review'), newIdempotencyKey('rating')]
    for (const id of ids) {
      expect(id).toMatch(ID_PATTERN)
      expect(id.slice(id.indexOf('_') + 1)).toMatch(UUID_V4)
    }
    const many = new Set(Array.from({ length: 1000 }, () => newRequestId()))
    expect(many.size).toBe(1000)
  })
})

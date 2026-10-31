/**
 * In-browser "database" for the mock backend.
 * Saved to sessionStorage so a page reload keeps drafts — this lets us test the
 * "reload and GET the draft" recovery flow. Close the tab or call resetMockDb() to clear.
 */
import type { Draft, Message } from '../types/contract'
import type { AuditEvent, OutboxEntry, Rating } from '../types/contractV11'

export interface StoredOutcome {
  bodyHash: string
  status: number
  body: unknown
  /** Response headers worth replaying (e.g. Retry-After) */
  headers?: Record<string, string>
}

interface MockDbState {
  drafts: Record<string, Draft>
  /** Canonical approved-template message per draft (what an edit must equal). */
  canonical: Record<string, Message | null>
  /** Idempotency records keyed by actor|method|path|key */
  idempotency: Record<string, StoredOutcome>
  /** Number of mock outbox rows per draft — must never exceed 1. */
  outbox: Record<string, number>
  nextDraft: number
  nextDelivery: number
  // ----- proposed v1.1.0 -----
  audit: Record<string, AuditEvent[]>
  outboxEntries: Record<string, OutboxEntry>
  ratings: Record<string, Rating[]>
  nextEvent: number
  nextRating: number
}

const STORAGE_KEY = 'codevortex.mockDb.v1'

function emptyState(): MockDbState {
  return {
    drafts: {},
    canonical: {},
    idempotency: {},
    outbox: {},
    nextDraft: 1,
    nextDelivery: 1,
    audit: {},
    outboxEntries: {},
    ratings: {},
    nextEvent: 1,
    nextRating: 1,
  }
}

function load(): MockDbState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return { ...emptyState(), ...(JSON.parse(raw) as Partial<MockDbState>) }
  } catch {
    // Storage unavailable or corrupted: start fresh.
  }
  return emptyState()
}

export const db: MockDbState = load()

export function saveDb(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Ignore: mocks still work in memory.
  }
}

export function resetMockDb(): void {
  Object.assign(db, emptyState())
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}

/** Requests currently being processed (for the "identical in-flight request" 409). Not persisted. */
export const inFlight = new Set<string>()

/** Create attempts per idempotency scope (for the timeout simulation). Not persisted. */
export const attempts = new Map<string, number>()

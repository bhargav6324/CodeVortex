/**
 * Recovery state kept in sessionStorage (cleared when the tab closes).
 *
 * The contract asks us to keep the active draft_id and the idempotency key of an action
 * whose outcome is unknown, so a lost response can be recovered after a reload.
 * Customer records and the reviewer token are never stored here.
 */
import type { ReviewRequest } from '../types/contract'

export type PendingAction =
  | { kind: 'create'; customerId: string; key: string }
  | { kind: 'review'; customerId: string; draftId: string; key: string; body: ReviewRequest }

export interface SavedSession {
  customerId: string
  draftId: string | null
  /** An action that was sent but whose outcome we have not confirmed. */
  pending: PendingAction | null
}

const STORAGE_KEY = 'codevortex.session.v1'

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<SavedSession>
    if (typeof value.customerId !== 'string') return null
    return {
      customerId: value.customerId,
      draftId: typeof value.draftId === 'string' ? value.draftId : null,
      pending: value.pending ?? null,
    }
  } catch {
    return null
  }
}

export function saveSession(session: SavedSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable (private mode etc.): the app still works, only recovery is lost.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}

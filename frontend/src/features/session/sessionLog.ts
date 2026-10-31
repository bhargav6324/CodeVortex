/**
 * What this browser session has done, for the Statistics and Audit tabs.
 *
 * Stored in sessionStorage (cleared when the tab closes), and per the backend guide it holds
 * only draft IDs, browser-measured timings and error counts — never customer records or
 * draft text. Drafts themselves are fetched again with GET /drafts/{id} when needed.
 */
import { useSyncExternalStore } from 'react'

export type DraftSource = 'review' | 'assistant' | 'demo'

export interface SessionDraft {
  draftId: string
  customerId: string
  /** Browser-measured generation time; null when the draft was only opened or replayed. */
  generationMs: number | null
  source: DraftSource
  at: string
}

export interface SessionLog {
  drafts: SessionDraft[]
  /** Error counts by code (e.g. RATE_LIMITED, AI_TIMEOUT), plus HTTP status where known. */
  errors: Record<string, number>
}

const KEY = 'codevortex.sessionLog.v1'
const EMPTY: SessionLog = { drafts: [], errors: {} }

function load(): SessionLog {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SessionLog>
    return { drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [], errors: parsed.errors ?? {} }
  } catch {
    return EMPTY
  }
}

let state: SessionLog = load()
const listeners = new Set<() => void>()

function commit(next: SessionLog) {
  state = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable: statistics still work for this page view.
  }
  listeners.forEach((l) => l())
}

export function recordDraft(entry: Omit<SessionDraft, 'at'>): void {
  const existing = state.drafts.find((d) => d.draftId === entry.draftId)
  if (existing) {
    if (existing.generationMs === null && entry.generationMs !== null) {
      commit({ ...state, drafts: state.drafts.map((d) => (d.draftId === entry.draftId ? { ...d, generationMs: entry.generationMs } : d)) })
    }
    return
  }
  commit({ ...state, drafts: [...state.drafts, { ...entry, at: new Date().toISOString() }] })
}

export function recordError(code: string): void {
  commit({ ...state, errors: { ...state.errors, [code]: (state.errors[code] ?? 0) + 1 } })
}

export function clearSessionLog(): void {
  commit(EMPTY)
}

export function getSessionLog(): SessionLog {
  return state
}

export function useSessionLog(): SessionLog {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getSessionLog,
  )
}

/**
 * AI assistant (conversation view) — types, context and the command parser.
 * Not free chat: every message maps to one of the four backend calls (FRONTEND_GUIDE.md §2).
 */
import { createContext, useContext } from 'react'
import type { ApiError } from '../../api/errors'
import type { Context, Delivery, Draft } from '../../types/contract'

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string; tone?: 'normal' | 'warning' }
  | { id: string; role: 'assistant'; kind: 'thinking'; text: string }
  | { id: string; role: 'assistant'; kind: 'draft'; headline: string; draft: Draft; context: Context | null; ms: number | null }
  | { id: string; role: 'assistant'; kind: 'error'; title: string; error: ApiError; canRetry: boolean }

export type Intent =
  | { type: 'draft'; customerId: string }
  | { type: 'approve'; delivery: Delivery }
  | { type: 'reject'; feedback: string | null }
  | { type: 'edit' }
  | { type: 'outOfRange'; raw: string }
  | { type: 'help' }

export interface AssistantValue {
  messages: ChatMessage[]
  busy: boolean
  /** The draft the conversation is currently about (latest revision). */
  current: Draft | null
  currentContext: Context | null
  editing: boolean
  /** True when the last edit was refused (keep the editor and the typed text). */
  editRefused: boolean
  canRetry: boolean
  send: (text: string) => void
  approve: (delivery: Delivery) => void
  reject: (feedback: string | null) => void
  openEditor: () => void
  closeEditor: () => void
  saveEdit: (subject: string, body: string) => void
  retry: () => void
  clear: () => void
}

export const AssistantContext = createContext<AssistantValue | null>(null)

export function useAssistant(): AssistantValue {
  const v = useContext(AssistantContext)
  if (v === null) throw new Error('useAssistant must be used inside AppProviders')
  return v
}

export const HELP_TEXT = 'I can draft, edit, approve or reject emails for C001–C050. Try “Draft an email for C004”.'

/** Maps what the reviewer typed to one action. Anything else gets the help reply (no call). */
export function parseIntent(text: string): Intent {
  const t = text.trim().toLowerCase()
  if (/mock/.test(t) && /(approve|send)/.test(t)) return { type: 'approve', delivery: 'mock_email' }
  if (/^approve\b/.test(t)) return { type: 'approve', delivery: 'draft_only' }
  if (/^reject\b/.test(t)) {
    const reason = text.trim().slice(6).replace(/^[\s:,.-]+/, '').trim()
    return { type: 'reject', feedback: reason === '' ? null : reason }
  }
  if (/^edit\b/.test(t)) return { type: 'edit' }
  const m = /\bc\s*0*(\d{1,3})\b/i.exec(text)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    if (n >= 1 && n <= 50) return { type: 'draft', customerId: `C${String(n).padStart(3, '0')}` }
    return { type: 'outOfRange', raw: m[0] }
  }
  return { type: 'help' }
}

/**
 * App-wide contexts (hooks + types). Providers live in AppProviders.tsx.
 *
 * - Token: the reviewer's bearer token, kept in memory only (never storage, env or URLs).
 * - Health: one shared /health poller, so every tab sees the same status.
 */
import { createContext, useContext } from 'react'
import type { BackendHealth } from '../hooks/useBackendHealth'

export interface TokenValue {
  tokenSet: boolean
  setToken: (token: string) => void
  /** Put the cursor in the header's token box (used after a 401). */
  focusTokenInput: () => void
  registerTokenInput: (el: HTMLInputElement | null) => void
}

export const TokenContext = createContext<TokenValue | null>(null)
export const HealthContext = createContext<BackendHealth | null>(null)

export function useToken(): TokenValue {
  const v = useContext(TokenContext)
  if (v === null) throw new Error('useToken must be used inside AppProviders')
  return v
}

export function useHealth(): BackendHealth {
  const v = useContext(HealthContext)
  if (v === null) throw new Error('useHealth must be used inside AppProviders')
  return v
}

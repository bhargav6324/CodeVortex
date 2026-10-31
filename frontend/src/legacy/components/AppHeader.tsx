import type { Ref } from 'react'
import { API_BASE_URL, USE_MOCKS } from '../../api/config'
import type { BackendHealth } from '../../hooks/useBackendHealth'
import { ContractBadge } from './ContractBadge'

function backendHost(): string {
  try {
    return new URL(API_BASE_URL).host
  } catch {
    return API_BASE_URL || 'backend'
  }
}

/**
 * Top bar: product name, connection status and the reviewer token input
 * (kept in memory only; App hands it to the API client).
 */
export function AppHeader({ token, onTokenChange, onResetMocks, tokenInputRef, health }: {
  token: string
  onTokenChange: (token: string) => void
  onResetMocks?: () => void
  /** Lets the page focus the token box (after a 401, or from the getting-started guide). */
  tokenInputRef?: Ref<HTMLInputElement>
  health: BackendHealth
}) {
  const version = health.version ?? '?'
  // In mock mode the "backend" answering is the in-browser mock, so say exactly that.
  const statusText = USE_MOCKS
    ? health.state === 'online'
      ? `Mock backend (in browser) · contract ${version}`
      : 'Mock backend not started'
    : {
        checking: 'Checking backend…',
        online: `Backend online · contract ${version}`,
        offline: 'Backend unreachable',
        unsupported: `Unsupported backend contract ${version}`,
      }[health.state]

  const tokenMissing = token.trim() === ''

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          CV
        </span>
        <span className="brand-text">
          <span className="brand-name">CodeVortex</span>
          <span className="brand-sub">Customer Loyalty &amp; Engagement · Reviewer console</span>
        </span>
      </div>

      <div className="header-status">
        <span
          className={`connection ${USE_MOCKS ? 'connection-mock' : `connection-${health.state}`}`}
          role="status"
          title={USE_MOCKS ? 'Responses come from the in-browser mock, not the real backend.' : API_BASE_URL}
        >
          <span className={`status-dot status-${health.state}`} aria-hidden="true" />
          {statusText}
          {!USE_MOCKS && health.state === 'online' && <span className="connection-host">{backendHost()}</span>}
        </span>
        {health.state !== 'online' && health.state !== 'checking' && (
          <button type="button" className="btn-ghost small" onClick={health.recheck}>
            Recheck
          </button>
        )}
        <ContractBadge />
        {USE_MOCKS && onResetMocks && (
          <button type="button" className="btn-ghost small" onClick={onResetMocks}>
            Reset mock data
          </button>
        )}
      </div>

      <label className={`token-field ${tokenMissing ? 'token-missing' : 'token-set'}`}>
        <span className="small token-label">{tokenMissing ? 'Reviewer token' : 'Token set ✓'}</span>
        <input
          ref={tokenInputRef}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="Paste reviewer token"
          aria-describedby="token-hint"
        />
        <span id="token-hint" className="sr-only">
          Kept in memory only. Paste it again after refreshing the page.
        </span>
      </label>
    </header>
  )
}

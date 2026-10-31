import { useEffect, useState } from 'react'
import type { ApiError } from '../../api/errors'
import { recoveryHint } from '../../utils/errorHints'

/** Seconds left until `readyAt` (ms timestamp), updated every second. */
function useSecondsUntil(readyAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (readyAt === null || readyAt <= Date.now()) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [readyAt])
  return readyAt === null ? 0 : Math.max(0, Math.ceil((readyAt - now) / 1000))
}

export interface RetryOptions {
  onRetry: () => void
  /** Earliest time (ms) the retry is allowed (from Retry-After). */
  readyAt: number | null
  disabled: boolean
}

/**
 * Shows an API error as plain text, a "what to do next" hint and the request_id.
 * When `retry` is given, offers "Retry same action", which reuses the same idempotency key.
 */
export function ErrorBanner({ title, error, hint, retry, onDismiss }: {
  title: string
  error: ApiError
  hint?: string | null
  retry?: RetryOptions
  onDismiss?: () => void
}) {
  const secondsLeft = useSecondsUntil(retry?.readyAt ?? null)

  return (
    <div className="banner banner-danger" role="alert">
      <div className="banner-body">
        <p className="banner-title">
          {title} <span className="code">{error.code}</span>
          {error.status !== null && <span className="muted small"> HTTP {error.status}</span>}
        </p>
        <p>{error.message}</p>
        {error.details.length > 0 && (
          <ul className="detail-list">
            {error.details.map((d, i) => (
              <li key={i}>
                {d.field && <span className="mono">{d.field}: </span>}
                {d.reason}
              </li>
            ))}
          </ul>
        )}
        <p className="banner-hint">{hint ?? recoveryHint(error, retry !== undefined)}</p>
        {(retry || onDismiss) && (
          <div className="banner-actions">
            {retry && (
              <button type="button" className="btn-primary" onClick={retry.onRetry} disabled={retry.disabled || secondsLeft > 0}>
                {secondsLeft > 0 ? `Retry in ${secondsLeft}s` : 'Retry same action'}
              </button>
            )}
            {onDismiss && (
              <button type="button" onClick={onDismiss} disabled={retry?.disabled}>
                {retry ? 'Discard' : 'Dismiss'}
              </button>
            )}
          </div>
        )}
        <p className="muted small">request_id: <span className="mono">{error.requestId}</span></p>
      </div>
    </div>
  )
}

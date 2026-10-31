import { AlertTriangle, CheckCircle2, Info, RotateCcw, X, XCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ApiError } from '../api/errors'
import { recoveryHint } from '../utils/errorHints'
import { Button } from './primitives'

type AlertTone = 'success' | 'info' | 'warning' | 'danger'

const STYLE: Record<AlertTone, { box: string; Icon: typeof Info }> = {
  success: { box: 'bg-emerald-50 text-emerald-900 ring-emerald-600/20', Icon: CheckCircle2 },
  info: { box: 'bg-sky-50 text-sky-900 ring-sky-600/20', Icon: Info },
  warning: { box: 'bg-amber-50 text-amber-900 ring-amber-600/25', Icon: AlertTriangle },
  danger: { box: 'bg-rose-50 text-rose-900 ring-rose-600/20', Icon: XCircle },
}

export function Alert({ tone, title, children, onDismiss, role }: {
  tone: AlertTone
  title: ReactNode
  children?: ReactNode
  onDismiss?: () => void
  role?: 'alert' | 'status'
}) {
  const { box, Icon } = STYLE[tone]
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={`flex gap-3 rounded-xl p-4 ring-1 ring-inset ${box}`}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="h-fit rounded-lg p-1 opacity-60 hover:bg-black/5 hover:opacity-100" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Seconds until `readyAt` (ms timestamp), updated while counting down. */
function useSecondsUntil(readyAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (readyAt === null || readyAt <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [readyAt])
  return readyAt === null ? 0 : Math.max(0, Math.ceil((readyAt - now) / 1000))
}

/**
 * API error as plain text with a "what to do next" hint and the request ID.
 * `onRetry` repeats the SAME action with the same idempotency key (safe, no duplicates).
 */
export function ErrorAlert({ title, error, hint, onRetry, retryReadyAt = null, onDismiss, busy = false }: {
  title: string
  error: ApiError
  hint?: string | null
  onRetry?: () => void
  retryReadyAt?: number | null
  onDismiss?: () => void
  busy?: boolean
}) {
  const wait = useSecondsUntil(retryReadyAt)
  return (
    <Alert
      tone="danger"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          <code className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px]">{error.code}</code>
          {error.status !== null && <span className="text-xs font-normal opacity-70">HTTP {error.status}</span>}
        </span>
      }
    >
      <p>{error.message}</p>
      {error.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {error.details.map((d, i) => (
            <li key={i}>
              {d.field && <span className="font-mono text-xs">{d.field}: </span>}
              {d.reason}
            </li>
          ))}
        </ul>
      )}
      <p className="font-medium">{hint ?? recoveryHint(error, onRetry !== undefined)}</p>
      {(onRetry || onDismiss) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {onRetry && (
            <Button variant="primary" size="sm" icon={RotateCcw} onClick={onRetry} disabled={busy || wait > 0}>
              {wait > 0 ? `Retry in ${wait}s` : 'Try again'}
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" onClick={onDismiss} disabled={busy}>
              {onRetry ? 'Discard' : 'Dismiss'}
            </Button>
          )}
        </div>
      )}
      <p className="text-xs opacity-70">
        request_id: <span className="font-mono">{error.requestId}</span>
      </p>
    </Alert>
  )
}

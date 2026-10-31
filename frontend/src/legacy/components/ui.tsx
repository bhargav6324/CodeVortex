/** Small presentational building blocks shared by the screens. */
import type { ReactNode } from 'react'
import type { Evidence } from '../../types/contract'
import { formatEvidenceValue, UNKNOWN } from '../../utils/format'
import type { BadgeTone } from '../../utils/labels'
import { Icon, type IconName } from './icons'

export function Card({ title, icon, actions, children, className = '' }: {
  title: string
  icon?: IconName
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>
          {icon && <Icon name={icon} size={15} className="card-icon" />}
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Badge({ tone, icon, children }: { tone: BadgeTone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}

/** Raw contract code, shown in monospace next to its friendly label. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="code">{children}</code>
}

/**
 * One label/value row. Pass a string that may be "Unknown"; it is styled so the
 * reviewer never mistakes an unknown value for a real one.
 */
export function Field({ label, value, mono = false, tone }: {
  label: string
  value: ReactNode
  mono?: boolean
  tone?: 'warning' | 'danger'
}) {
  const unknown = value === UNKNOWN || value === null || value === undefined
  const classes = ['field-value', mono && 'mono', unknown && 'unknown', tone && `text-${tone}`]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={classes}>{unknown ? UNKNOWN : value}</dd>
    </div>
  )
}

/** `rows`: label left, value right. `grid`: label above value, laid out in columns. */
export function Fields({ children, variant = 'rows' }: { children: ReactNode; variant?: 'rows' | 'grid' }) {
  return <dl className={`fields fields-${variant}`}>{children}</dl>
}

/** KPI tile: small label, large value, optional hint underneath. */
export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName }) {
  const unknown = value === UNKNOWN || value === null
  return (
    <div className="stat">
      <span className="stat-label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </span>
      <span className={`stat-value ${unknown ? 'unknown' : ''}`}>{unknown ? UNKNOWN : value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

/** Initials avatar. Purely decorative; the name is always shown as text next to it. */
export function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  return (
    <span className="avatar" aria-hidden="true">
      {initials}
    </span>
  )
}

/** Yes/No flag shown as a coloured pill with an icon (for consent and similar booleans). */
export function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className={`flag ${on ? 'flag-on' : 'flag-off'}`}>
      <span className="flag-icon">
        <Icon name={on ? 'check' : 'x'} size={12} />
      </span>
      <span className="flag-label">{label}</span>
      <span className="flag-value">{on ? 'Yes' : 'No'}</span>
    </div>
  )
}

export function EvidenceTable({ evidence, emptyText = 'No evidence returned.' }: {
  evidence: Evidence[]
  emptyText?: string
}) {
  if (evidence.length === 0) return <p className="muted small">{emptyText}</p>
  return (
    <table className="evidence">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {evidence.map((e, i) => (
          <tr key={`${e.field}-${i}`}>
            <td className="mono">{e.field}</td>
            <td className={`mono ${e.value === null ? 'unknown' : ''}`}>{formatEvidenceValue(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  )
}

/** Small shared building blocks: badges, buttons, fields, KPI tiles, spinners, empty states. */
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { UNKNOWN } from '../utils/format'

export type Tone = 'info' | 'success' | 'danger' | 'warning' | 'neutral' | 'brand'

const BADGE: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
}

export function Badge({ tone, icon: Icon, children, size = 'sm' }: { tone: Tone; icon?: LucideIcon; children: ReactNode; size?: 'sm' | 'lg' }) {
  const sizing = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${sizing} ${BADGE[tone]}`}>
      {Icon && <Icon className={size === 'lg' ? 'size-4' : 'size-3.5'} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Raw contract code (monospace), shown next to its friendly label. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">{children}</code>
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'

const BUTTON: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-brand hover:from-brand-600 hover:to-brand-700 ring-1 ring-brand-600',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 ring-1 ring-emerald-700',
  danger: 'bg-white text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 shadow-sm hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: LucideIcon
}) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:from-slate-100 disabled:to-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:ring-slate-200 ${sizing} ${BUTTON[variant]} ${className}`}
      {...rest}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden="true" />}
      {children}
    </button>
  )
}

/** Label/value row. "Unknown" (null) values are styled so they never look like real data. */
export function Field({ label, value, mono = false, tone }: { label: string; value: ReactNode; mono?: boolean; tone?: 'danger' | 'warning' }) {
  const unknown = value === UNKNOWN || value === null || value === undefined
  const toneClass = tone === 'danger' ? 'font-semibold text-rose-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="grid grid-cols-[minmax(110px,42%)_1fr] items-baseline gap-3 py-1.5">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-[13px] ${mono ? 'font-mono text-xs' : 'font-medium'} ${unknown ? 'italic text-slate-400' : toneClass}`}>
        {unknown ? UNKNOWN : value}
      </dd>
    </div>
  )
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-dashed divide-slate-100">{children}</dl>
}

export function StatTile({ label, value, hint, icon: Icon, accent = false }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  accent?: boolean
}) {
  const unknown = value === UNKNOWN || value === null
  return (
    <div className={`min-w-0 rounded-xl p-3.5 ring-1 ring-inset ${accent ? 'bg-gradient-to-br from-brand-50 to-violet-50 ring-brand-100' : 'bg-slate-50/70 ring-slate-200/70'}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tracking-tight ${unknown ? 'italic text-slate-400' : 'text-slate-900'}`}>{unknown ? UNKNOWN : value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2.5 text-sm text-slate-600">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" aria-hidden="true" />
      {label}
    </p>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-50 text-brand-600 ring-1 ring-brand-100">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <p className="mt-3 font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Plain-text block that keeps line breaks. React escapes the text; never render model output as HTML. */
export function PlainText({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`whitespace-pre-wrap break-words ${className}`}>{children}</div>
}

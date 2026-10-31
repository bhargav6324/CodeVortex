import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Base surface for page content: white, rounded, subtle border and shadow. */
export function Card({ title, icon: Icon, actions, children, className = '', bodyClassName = '' }: {
  title?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {Icon && <Icon className="size-4 text-brand-600" aria-hidden="true" />}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

/** Small uppercase heading inside a card body. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</h3>
}

import { Sparkles, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { USE_MOCKS } from '../api/config'
import { useHealth, useToken } from '../app/context'
import { visibleNav } from './navigation'

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 shadow-brand">
        <Sparkles className="size-[18px] text-white" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-[17px] font-bold tracking-tight text-white">
          Loyalty<span className="text-brand-300">AI</span>
        </span>
        <span className="block text-[11px] text-slate-400">by CodeVortex</span>
      </span>
    </div>
  )
}

/** Dark navy sidebar with the guide's tabs. Desktop: fixed. Mobile: slide-in drawer. */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = useHealth()
  const { tokenSet } = useToken()
  const items = visibleNav(health.extensions)

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-sm transition-opacity lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gradient-to-b from-navy-900 via-navy-900 to-navy-950 transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Logo />
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close navigation">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Workspace</p>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.path}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      isActive ? 'bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-brand' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`
                  }
                >
                  <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  {item.proposed && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-200">v1.1</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="m-4 space-y-2 rounded-xl bg-white/[0.04] p-3.5 text-xs ring-1 ring-white/[0.06]">
          <p className="font-semibold uppercase tracking-wider text-slate-500">Session</p>
          <p className="flex items-center justify-between text-slate-300">
            Reviewer token
            <span className={tokenSet ? 'font-semibold text-emerald-400' : 'text-amber-300'}>{tokenSet ? 'Set' : 'Missing'}</span>
          </p>
          <p className="flex items-center justify-between text-slate-300">
            Data
            <span className={USE_MOCKS ? 'text-amber-300' : 'text-emerald-400'}>{USE_MOCKS ? 'Mock backend' : 'Live backend'}</span>
          </p>
          <p className="pt-1 leading-relaxed text-slate-500">Nothing is ever really emailed. "Mock-send" only records an outbox row.</p>
        </div>
      </aside>
    </>
  )
}

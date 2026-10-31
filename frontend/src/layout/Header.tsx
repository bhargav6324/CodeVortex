import { KeyRound, Menu, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { USE_MOCKS } from '../api/config'
import { useHealth, useToken } from '../app/context'
import { findNavItem } from './navigation'

/** "Backend online · contract 1.0.0" / "Backend offline", checked every 30 seconds. */
function SystemStatus() {
  const health = useHealth()
  const view =
    health.state === 'online'
      ? { dot: 'bg-emerald-500', box: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', text: `Backend online · contract ${health.version}` }
      : health.state === 'checking'
        ? { dot: 'bg-slate-400 animate-pulse', box: 'bg-slate-50 text-slate-600 ring-slate-500/20', text: 'Checking backend…' }
        : health.state === 'unsupported'
          ? { dot: 'bg-rose-500', box: 'bg-rose-50 text-rose-700 ring-rose-600/20', text: `Unsupported contract ${health.version}` }
          : { dot: 'bg-rose-500', box: 'bg-rose-50 text-rose-700 ring-rose-600/20', text: 'Backend offline' }

  return (
    <div className="flex items-center gap-1.5">
      <span
        role="status"
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${view.box}`}
        title={USE_MOCKS ? 'Mock backend running in this browser' : 'Checked every 30 seconds. /health does not cover the AI service.'}
      >
        <span className={`size-2 rounded-full ${view.dot}`} aria-hidden="true" />
        <span className="hidden sm:inline">{USE_MOCKS ? `Mock · ${view.text}` : view.text}</span>
      </span>
      {(health.state === 'offline' || health.state === 'unsupported') && (
        <button type="button" onClick={health.recheck} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Check backend again">
          <RefreshCw className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Reviewer token: memory only. Cleared by a page reload, by design. */
function TokenField() {
  const { tokenSet, setToken, registerTokenInput } = useToken()
  const [value, setValue] = useState('')
  return (
    <label className="relative flex items-center">
      <span className="sr-only">Reviewer token</span>
      <KeyRound className={`pointer-events-none absolute left-3 size-4 ${tokenSet ? 'text-emerald-600' : 'text-brand-500'}`} aria-hidden="true" />
      <input
        ref={registerTokenInput}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setToken(e.target.value)
        }}
        placeholder="Paste reviewer token"
        aria-describedby="token-help"
        className={`h-10 w-44 rounded-xl border bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-4 sm:w-56 ${
          tokenSet ? 'border-emerald-300 focus:ring-emerald-100' : 'border-brand-300 ring-4 ring-brand-100 focus:ring-brand-200'
        }`}
      />
      <span id="token-help" className="sr-only">
        Kept in memory only. Paste it again after reloading the page.
      </span>
    </label>
  )
}

export function Header({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const page = findNavItem(useLocation().pathname)
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md sm:px-6">
      <button type="button" onClick={onOpenSidebar} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-slate-900">{page?.label ?? 'LoyaltyAI'}</p>
        <p className="hidden truncate text-xs text-slate-500 md:block">{page?.description}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <SystemStatus />
        <TokenField />
      </div>
    </header>
  )
}

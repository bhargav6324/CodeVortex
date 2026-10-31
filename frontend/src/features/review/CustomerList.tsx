import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CUSTOMER_GROUP_LABELS, type CustomerGroup, type KnownCustomer } from '../../config/customers'

const ORDER: CustomerGroup[] = ['scenario', 'blocked', 'mock', 'dataset']

/** Customer picker. v1 has no customer-list API, so the IDs live in the frontend (C001–C050). */
export function CustomerList({ customers, selectedId, onSelect, disabled }: {
  customers: KnownCustomer[]
  selectedId: string
  onSelect: (id: string) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? customers.filter((c) => c.id.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)) : customers
  }, [customers, query])

  return (
    <div className="flex max-h-[calc(100vh-7.5rem)] min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-card lg:sticky lg:top-[5.5rem]">
      <div className="border-b border-slate-100 p-3">
        <label className="relative block">
          <span className="sr-only">Filter customers</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter C001–C050…"
            className="h-9 w-full rounded-lg bg-slate-100 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2" role="listbox" aria-label="Customers">
        {ORDER.map((group) => {
          const items = filtered.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{CUSTOMER_GROUP_LABELS[group]}</p>
              {items.map((c) => {
                const selected = c.id === selectedId
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    onClick={() => onSelect(c.id)}
                    data-customer={c.id}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`font-mono text-xs font-semibold ${selected ? 'text-brand-700' : 'text-slate-500'}`}>{c.id}</span>
                    <span className="truncate">{c.label}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No customer matches “{query}”.</p>}
      </div>
    </div>
  )
}

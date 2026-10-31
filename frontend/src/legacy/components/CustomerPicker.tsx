import { CUSTOMER_GROUP_LABELS, type CustomerGroup, type KnownCustomer } from '../../config/customers'

const GROUP_ORDER: CustomerGroup[] = ['scenario', 'blocked', 'mock', 'dataset']

/**
 * Picks one of the known customer IDs (v1 has no customer-list API), grouped by scenario type.
 * The label is UI-only; only the ID is sent to the backend.
 */
export function CustomerPicker({ customers, value, onChange, onLoad, disabled, hasToken }: {
  customers: KnownCustomer[]
  value: string
  onChange: (customerId: string) => void
  onLoad: () => void
  disabled: boolean
  hasToken: boolean
}) {
  return (
    <div className="card picker">
      <label htmlFor="customer-select" className="picker-label">
        Customer
      </label>
      <div className="picker-row">
        <select id="customer-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {GROUP_ORDER.map((group) => {
            const items = customers.filter((c) => c.group === group)
            if (items.length === 0) return null
            return (
              <optgroup key={group} label={CUSTOMER_GROUP_LABELS[group]}>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.label}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        <button type="button" onClick={onLoad} disabled={disabled || !hasToken}>
          Load
        </button>
      </div>
      <p className="muted small">
        {hasToken ? 'Changing the customer loads their data automatically.' : 'Paste the reviewer token first (top right).'}
      </p>
    </div>
  )
}

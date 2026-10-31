import { useSyncExternalStore } from 'react'
import { clearMismatches, getMismatches, subscribeMismatches } from '../../api/contractMonitor'

/**
 * Development-only: shows how many requests/responses did not match the frozen contract.
 * Any count above zero on integration day is a contract bug to raise with the backend team.
 */
export function ContractBadge() {
  const mismatches = useSyncExternalStore(subscribeMismatches, getMismatches)
  if (!import.meta.env.DEV || mismatches.length === 0) return null

  return (
    <details className="contract-badge">
      <summary className="badge badge-danger">
        {mismatches.length} contract mismatch{mismatches.length === 1 ? '' : 'es'}
      </summary>
      <div className="contract-popover">
        <p className="small">These requests or responses do not match contract v1.0.0. Details are also in the browser console.</p>
        <ul className="plain-list">
          {[...mismatches].reverse().map((m, i) => (
            <li key={i}>
              <span className="small">
                <strong>{m.where}</strong> vs <span className="mono">{m.schema}</span>
              </span>
              <ul className="detail-list small mono">
                {m.errors.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <button type="button" className="small" onClick={clearMismatches}>
          Clear
        </button>
      </div>
    </details>
  )
}

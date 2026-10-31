/**
 * Display formatting. Rules from the contract:
 * - null means unknown: show "Unknown", never 0 / "No".
 * - Money is integer paise: 149900 -> "INR 1499.00" (same format the emails use).
 * - Times are UTC; show them in UTC so they match the backend's day calculations.
 */
import type { Evidence, Money } from '../types/contract'

export const UNKNOWN = 'Unknown'

export function formatMoney(money: Money | null): string {
  if (money === null) return UNKNOWN
  return `${money.currency} ${(money.amount_minor / 100).toFixed(2)}`
}

/** "2026-10-31T06:00:00Z" -> "2026-10-31 06:00 UTC" */
export function formatUtc(timestamp: string | null): string {
  if (timestamp === null) return UNKNOWN
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp
  const iso = d.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/** UTC calendar date of a timestamp: "2026-11-30T23:59:59Z" -> "2026-11-30" */
export function utcDate(timestamp: string): string {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? timestamp : d.toISOString().slice(0, 10)
}

export function formatDate(date: string | null): string {
  return date ?? UNKNOWN
}

export function formatCount(value: number | null): string {
  return value === null ? UNKNOWN : String(value)
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** Evidence values are shown exactly; paise amounts get an INR hint for the reviewer. */
export function formatEvidenceValue(evidence: Evidence): string {
  const { field, value } = evidence
  if (value === null) return 'null (unknown)'
  if (typeof value === 'number' && field.endsWith('amount_minor')) {
    return `${value} (INR ${(value / 100).toFixed(2)})`
  }
  return String(value)
}

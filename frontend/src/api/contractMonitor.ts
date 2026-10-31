/**
 * Development-only record of contract mismatches (request or response JSON that does not
 * match the frozen schema). The header shows a badge when this list is not empty.
 */
import type { SchemaName } from './contractCheck'

export interface ContractMismatch {
  /** e.g. "POST /api/v1/drafts response" */
  where: string
  schema: SchemaName
  errors: string[]
  at: string
}

let mismatches: ContractMismatch[] = []
const listeners = new Set<() => void>()

export function getMismatches(): ContractMismatch[] {
  return mismatches
}

export function subscribeMismatches(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearMismatches(): void {
  mismatches = []
  listeners.forEach((l) => l())
}

/** Validate in the background and record any mismatch. No-op in production builds. */
export function checkContractInDev(where: string, schema: SchemaName, data: unknown): void {
  if (!import.meta.env.DEV) return
  void import('./contractCheck').then(({ contractErrors }) => {
    const errors = contractErrors(schema, data)
    if (errors.length === 0) return
    console.error(`[contract] ${where} does not match ${schema}:`, errors, data)
    mismatches = [...mismatches, { where, schema, errors, at: new Date().toISOString() }].slice(-50)
    listeners.forEach((l) => l())
  })
}

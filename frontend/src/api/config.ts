/** Public, non-secret configuration read from .env at build time. */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/** Browser timeout from the contract (backend budget is 30 s, browser waits up to 40 s). */
export const REQUEST_TIMEOUT_MS = 40_000

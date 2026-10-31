import type { ErrorBody, ErrorCode } from '../types/contract'

/**
 * Codes produced by the browser itself when no backend Error body is available.
 * - CLIENT_TIMEOUT: no answer within 40 s (outcome unknown — retry with the SAME key)
 * - NETWORK_ERROR:  request never reached the server or connection dropped (outcome unknown)
 * - BAD_RESPONSE:   server answered with something that is not the contract's JSON
 */
export type ClientErrorCode = 'CLIENT_TIMEOUT' | 'NETWORK_ERROR' | 'BAD_RESPONSE'

export interface ApiErrorInit {
  status: number | null
  code: ErrorCode | ClientErrorCode
  message: string
  requestId: string
  retryable: boolean
  retryAfterSeconds: number | null
  details: ErrorBody['error']['details']
}

/** The single error type every API function throws. Screens only need to handle this. */
export class ApiError extends Error {
  /** HTTP status, or null when there was no HTTP response (timeout / network). */
  readonly status: number | null
  readonly code: ErrorCode | ClientErrorCode
  /** Show this in the UI so the backend developer can find the request in their logs. */
  readonly requestId: string
  readonly retryable: boolean
  /** Seconds to wait before retrying (from the Retry-After header), if given. */
  readonly retryAfterSeconds: number | null
  readonly details: ErrorBody['error']['details']

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.retryable = init.retryable
    this.retryAfterSeconds = init.retryAfterSeconds
    this.details = init.details
  }

  /** True when we cannot know whether the server applied the action (retry with the same key). */
  get outcomeUnknown(): boolean {
    return this.code === 'CLIENT_TIMEOUT' || this.code === 'NETWORK_ERROR'
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

/** Wrap anything thrown into an ApiError so screens have one error type to render. */
export function toApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value
  return new ApiError({
    status: null,
    code: 'BAD_RESPONSE',
    message: value instanceof Error ? value.message : 'Unexpected error.',
    requestId: '-',
    retryable: false,
    retryAfterSeconds: null,
    details: [],
  })
}

/** Narrow check that a parsed JSON value has the contract's Error shape. */
export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  )
}

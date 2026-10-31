/**
 * The ONE request wrapper. Every API call goes through `request()`.
 *
 * It handles: base URL, Authorization, X-Request-ID, Idempotency-Key,
 * JSON parsing, the 40 s timeout and converting failures into ApiError.
 *
 * It never retries on its own. Retrying is a caller decision, and a retry of the
 * same user action must pass the same idempotency key and the exact same body.
 */
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config'
import type { SchemaName } from './contractCheck'
import { checkContractInDev } from './contractMonitor'
import { ApiError, isErrorBody } from './errors'
import { newRequestId } from '../utils/ids'

// ---------------------------------------------------------------------------
// Reviewer token — kept in memory only (never .env, localStorage, URLs or logs).
// After a page refresh the reviewer pastes it again; that is intentional.
// ---------------------------------------------------------------------------

let authToken: string | null = null

export function setAuthToken(token: string | null): void {
  const trimmed = token?.trim() ?? ''
  authToken = trimmed === '' ? null : trimmed
}

export function hasAuthToken(): boolean {
  return authToken !== null
}

// ---------------------------------------------------------------------------

export interface RequestOptions {
  method: 'GET' | 'POST'
  /** Path starting with "/", e.g. "/api/v1/drafts" */
  path: string
  body?: unknown
  /** Required by the contract for every public POST. */
  idempotencyKey?: string
  /** Send a specific request ID; otherwise a new one is generated. */
  requestId?: string
  /** Contract schemas for dev-time checking of the request body and success response. */
  requestSchema?: SchemaName
  responseSchema?: SchemaName
}

export interface ApiResponse<T> {
  data: T
  /** HTTP status, e.g. 201 for a new draft and 200 for an idempotent replay */
  status: number
  /** Request ID echoed by the server (falls back to the one we sent) */
  requestId: string
  contractVersion: string | null
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('Retry-After')
  if (raw === null) return null
  const seconds = Number.parseInt(raw, 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Error listeners (e.g. the session statistics count errors by code).
// ---------------------------------------------------------------------------

const errorListeners = new Set<(error: ApiError) => void>()

export function onApiError(listener: (error: ApiError) => void): () => void {
  errorListeners.add(listener)
  return () => errorListeners.delete(listener)
}

export async function request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
  try {
    return await send<T>(options)
  } catch (e) {
    if (e instanceof ApiError) errorListeners.forEach((l) => l(e))
    throw e
  }
}

async function send<T>(options: RequestOptions): Promise<ApiResponse<T>> {
  const sentRequestId = options.requestId ?? newRequestId()
  const where = `${options.method} ${options.path}`
  if (options.requestSchema && options.body !== undefined) {
    checkContractInDev(`${where} request`, options.requestSchema, options.body)
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-ID': sentRequestId,
  }
  if (authToken !== null) headers.Authorization = `Bearer ${authToken}`
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    const timedOut = controller.signal.aborted
    throw new ApiError({
      status: null,
      code: timedOut ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR',
      message: timedOut
        ? 'The server did not answer within 40 seconds. You can retry the same action safely.'
        : 'Could not reach the server. Check the network or backend, then retry the same action.',
      requestId: sentRequestId,
      retryable: true,
      retryAfterSeconds: null,
      details: [],
    })
  } finally {
    clearTimeout(timer)
  }

  const requestId = response.headers.get('X-Request-ID') ?? sentRequestId
  const json = await readJson(response)

  if (response.ok) {
    if (json === undefined) {
      throw new ApiError({
        status: response.status,
        code: 'BAD_RESPONSE',
        message: 'The server returned an empty or non-JSON response.',
        requestId,
        retryable: false,
        retryAfterSeconds: null,
        details: [],
      })
    }
    if (options.responseSchema) checkContractInDev(`${where} response`, options.responseSchema, json)
    return {
      data: json as T,
      status: response.status,
      requestId,
      contractVersion: response.headers.get('X-Contract-Version'),
    }
  }

  if (json !== undefined) checkContractInDev(`${where} error (HTTP ${response.status})`, 'Error', json)

  if (isErrorBody(json)) {
    throw new ApiError({
      status: response.status,
      code: json.error.code,
      message: json.error.message,
      requestId: json.error.request_id || requestId,
      retryable: json.error.retryable === true,
      retryAfterSeconds: parseRetryAfter(response.headers),
      details: Array.isArray(json.error.details) ? json.error.details : [],
    })
  }

  throw new ApiError({
    status: response.status,
    code: 'BAD_RESPONSE',
    message: `Unexpected response from the server (HTTP ${response.status}).`,
    requestId,
    retryable: false,
    retryAfterSeconds: parseRetryAfter(response.headers),
    details: [],
  })
}

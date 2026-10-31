/**
 * Every ID we send must match the contract pattern ^[A-Za-z0-9_-]{1,64}$.
 * `<prefix>_<uuid>` is always valid: a UUID contains only hex digits and dashes.
 *
 * Uses crypto.getRandomValues, NOT crypto.randomUUID: randomUUID only exists in secure
 * contexts (HTTPS or localhost), so it is undefined when teammates open the app over plain
 * HTTP on Tailscale (http://100.117.73.55:5173). getRandomValues works in every context.
 */
function uuidV4(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function makeId(prefix: string): string {
  return `${prefix}_${uuidV4()}`
}

/** One per HTTP request (X-Request-ID). */
export function newRequestId(): string {
  return makeId('REQ')
}

/**
 * One per user action (Idempotency-Key).
 * Create a new key for each click; reuse the same key only when retrying that same click.
 */
export function newIdempotencyKey(action: 'create' | 'review' | 'rating'): string {
  return makeId(action)
}

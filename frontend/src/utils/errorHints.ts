import type { ApiError } from '../api/errors'

/** One plain-language "what to do next" line for each error code. */
export function recoveryHint(error: ApiError, canRetry: boolean): string {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return canRetry
        ? 'Paste a valid reviewer token at the top of the page, then retry.'
        : 'Paste a valid reviewer token at the top of the page, then try again.'
    case 'FORBIDDEN':
      return 'Your reviewer access does not allow this. Do not retry.'
    case 'NOT_FOUND':
      return 'The customer or draft was not found.'
    case 'IDEMPOTENCY_CONFLICT':
      return 'A request key was reused with different content (a frontend bug). Start the action again.'
    case 'VERSION_CONFLICT':
      return error.retryable
        ? 'The same action is still being processed. Wait a moment, then retry.'
        : 'The draft changed on the server. It has been reloaded; review it before acting again.'
    case 'INVALID_TRANSITION':
      return 'This draft is already final. It has been reloaded to show its current state.'
    case 'REVIEW_BLOCKED':
      return 'Current checks failed. Nothing was sent.'
    case 'INVALID_REQUEST':
      return 'The request did not match the API contract. Report this with the request ID.'
    case 'RATE_LIMITED':
      return 'Too many requests. Wait for the countdown, then retry.'
    case 'AI_TIMEOUT':
    case 'CLIENT_TIMEOUT':
    case 'NETWORK_ERROR':
      return 'The outcome is unknown. Retrying reuses the same request key, so the action cannot happen twice.'
    case 'SERVICE_UNAVAILABLE':
      return canRetry ? 'The AI service is unavailable. Retry when it is back.' : 'The service is unavailable. Try again later.'
    case 'INTERNAL_ERROR':
    case 'BAD_RESPONSE':
      return 'Unexpected server response. Report this with the request ID.'
  }
}

/**
 * Domain error for business-rule violations that callers should map to a 409
 * Conflict (or similar non-500) HTTP status. Use the `code` field as a stable
 * machine-readable identifier — callers can branch on it without parsing
 * `message`, which is free-form.
 *
 * Distinct from generic `Error` (5xx) so the API layer can confidently surface
 * a localized, recoverable message to the UI.
 */
export class BusinessError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code)
    this.name = 'BusinessError'
  }
}

/**
 * Authorization failure: the caller is authenticated but lacks the role for
 * this operation. Thrown by `requireRole` / `requirePlatformAdmin` and mapped
 * to a 403 by `handleApiError`.
 *
 * A distinct class rather than `new Error('Forbidden')` because the API layer
 * used to detect this with `error.message.includes('Forbidden')`, which also
 * swallowed any *real* failure whose message happened to mention the word
 * (an upstream "403 Forbidden" from Meta or Google, say), turning a bug into a
 * silent 403 that never reached Sentry.
 */
export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

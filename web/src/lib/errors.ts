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

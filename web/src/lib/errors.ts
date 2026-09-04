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

/**
 * True when the driver rejected a write because it violated a unique index.
 *
 * Postgres reports this as SQLSTATE 23505 and names the index it hit.
 * Matching on the name rather than the class keeps an unrelated collision
 * elsewhere in the same transaction from being mistaken for the one the
 * caller is prepared to handle.
 *
 * Walks the cause chain because drizzle does not rethrow the driver's error:
 * it wraps it in a `DrizzleQueryError` whose own `code` is undefined and
 * hangs the real one off `cause`. Reading only the top level silently never
 * matches, which is a failure mode no mocked test can see.
 */
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  for (let current: unknown = err; current != null; current = (current as { cause?: unknown }).cause) {
    if (typeof current !== 'object') return false
    const e = current as { code?: unknown; constraint_name?: unknown }
    if (e.code === '23505') {
      return constraintName === undefined || e.constraint_name === constraintName
    }
  }
  return false
}

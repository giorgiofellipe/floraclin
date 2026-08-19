/**
 * URL-to-path parsing for the one-shot `tenants.logo_url` migration.
 *
 * `tenants.logo_url` used to hold a full Supabase signed URL with a 1-year
 * token baked in; it now holds the bare storage path and is signed on read
 * (`signLogoPath`, `@/lib/logo`). Only `web/scripts/migrate-logo-urls-to-paths.ts`
 * uses this module. Delete both once every environment has been converted.
 */

/** The bucket the logo upload route writes to (`/api/tenant/logo`). */
const BUCKET_NAME = 'floraclin'

/**
 * Supabase signed object URLs look like
 * `https://<host>/storage/v1/object/sign/<bucket>/<path>?token=...`.
 * Anything else is reported rather than guessed at.
 */
const SIGNED_OBJECT_PATH_RE = new RegExp(`^/storage/v1/object/sign/${BUCKET_NAME}/(.+)$`)

export type ParsedLogoUrl =
  /** A signed URL whose storage path was recovered. */
  | { kind: 'converted'; path: string }
  /** Already a bare storage path, so a re-run leaves it alone. */
  | { kind: 'already-path' }
  /** Not a shape this migration knows how to convert. Left untouched. */
  | { kind: 'unparseable'; reason: string }

/**
 * Recovers the storage path from a stored `tenants.logo_url` value.
 *
 * Never blanks a value it does not understand: a row it cannot parse is
 * reported so an operator can look at it, because the alternative is silently
 * losing a clinic's logo.
 */
export function parseLogoUrl(value: string): ParsedLogoUrl {
  const trimmed = value.trim()
  if (trimmed === '') return { kind: 'unparseable', reason: 'valor vazio' }

  if (!/^https?:\/\//i.test(trimmed)) return { kind: 'already-path' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { kind: 'unparseable', reason: 'URL inválida' }
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return { kind: 'unparseable', reason: 'pathname com escape inválido' }
  }

  const match = SIGNED_OBJECT_PATH_RE.exec(pathname)
  if (!match) {
    return {
      kind: 'unparseable',
      reason: `não é uma URL assinada do bucket ${BUCKET_NAME} (${url.pathname})`,
    }
  }

  return { kind: 'converted', path: match[1] }
}

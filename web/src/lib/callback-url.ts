/**
 * Where to send someone after they sign in, taken from `?callbackUrl=` on
 * /login. Only a same-origin relative path is ever returned, so the parameter
 * cannot be turned into an open redirect: absolute and protocol-relative URLs,
 * backslash tricks (`/\evil.com`, which browsers read as `//evil.com`) and
 * control characters are all refused.
 *
 * The auth pages themselves are refused too, so a callback cannot bounce a
 * freshly signed-in user back to /login.
 */
const BASE = 'https://callback.invalid'
const MAX_LENGTH = 2048
const AUTH_PAGES = new Set(['/', '/login', '/signup', '/reset-password'])

export const CALLBACK_URL_PARAM = 'callbackUrl'

export function safeCallbackPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null

  let url: URL
  try {
    url = new URL(value, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  // Dot segments are resolved by the parse: `/.//evil.example` comes out as
  // `//evil.example`, which a later `new URL(path, origin)` reads as another host.
  if (url.pathname.startsWith('//')) return null
  if (AUTH_PAGES.has(url.pathname) || url.pathname.startsWith('/api/')) return null
  return `${url.pathname}${url.search}`
}

/**
 * TTL for the signed URL minted around `tenants.logo_url`.
 *
 * The column holds a storage PATH, not a URL: every read boundary that feeds
 * a renderer signs it fresh, so the TTL only has to outlive a single render
 * or page view. One hour does that with room to spare, and keeps a URL that
 * leaks out of a PDF or the public booking page from working for long.
 */
export const LOGO_SIGNED_URL_TTL = 60 * 60 // 1 hour

/**
 * Largest logo we will inline into a PDF. Mirrors the upload cap in
 * `/api/tenant/logo`, so anything that got into storage through the app fits,
 * and a file that somehow did not cannot bloat the rendered HTML.
 */
const MAX_LOGO_BYTES = 1 * 1024 * 1024 // 1 MB

/** How long `fetchLogoDataUri` waits before giving up on storage. */
const LOGO_FETCH_TIMEOUT_MS = 3000

/**
 * Turns a `tenants.logo_url` storage path into a short-lived signed URL.
 *
 * Returns null for a tenant with no logo and null when signing fails, so a
 * broken or missing logo degrades to a header with no image. This is called
 * from render paths (report PDFs, print pages, the public booking page), and
 * a clinic's whole prontuário must not 500 because storage hiccuped.
 */
export async function signLogoPath(path: string | null): Promise<string | null> {
  if (!path) return null
  try {
    // Imported lazily on purpose. `@/lib/storage` pulls in the service-role
    // Supabase client, which throws on import outside the server. This module
    // is reached from `@/db/queries/*`, so a static import would drag that
    // guard into every consumer of those query modules.
    const { getSignedUrl } = await import('@/lib/storage')
    return await getSignedUrl(path, LOGO_SIGNED_URL_TTL)
  } catch {
    return null
  }
}

/**
 * Fetches a signed logo URL server-side and returns it as a base64 `data:`
 * URI, so a PDF render makes no network request of its own.
 *
 * `renderReactToPdf` hands the HTML to headless Chromium, which blocks on
 * every remote `<img>` until it loads or Puppeteer's 30s default expires. A
 * slow or blackholed storage host would stall the render and then 500; a dead
 * URL would print a broken-image box inside a document handed to a patient or
 * an accountant. Null on any failure, which `<ClinicHeader>` renders as no
 * image at all.
 */
export async function fetchLogoDataUri(
  signedUrl: string | null,
  timeoutMs: number = LOGO_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  if (!signedUrl) return null
  try {
    const res = await fetch(signedUrl, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!contentType.startsWith('image/')) return null

    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null

    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

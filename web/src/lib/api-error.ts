import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ForbiddenError } from './errors'
import { maskPath } from './observability'

// Next 16.2.3 (the version installed here, see `web/package.json`) no
// longer re-exports `isRedirectError` from the public `next/navigation`
// entry point: verified against
// `node_modules/next/dist/client/components/navigation.d.ts`, whose export
// list ends at `redirect`, `permanentRedirect`, `notFound`, `forbidden`,
// `unauthorized`, `unstable_rethrow` and the `use*` hooks, no
// `isRedirectError`. Older Next versions (and most training data) exported
// it directly from `next/navigation`. The function still exists internally
// (`node_modules/next/dist/client/components/redirect-error.js`), but
// importing from `next/dist/*` reaches into an unversioned path this repo
// shouldn't pin to.
//
// The signal it checks is a small, stable contract instead: `redirect()` /
// `permanentRedirect()` throw an `Error` whose `digest` starts with
// `NEXT_REDIRECT;` (same file). Next's own `isRedirectError` goes further and
// validates the type, destination and status inside the digest; this prefix
// check accepts anything Next produces without re-encoding those details, and
// unlike a substring match on the message,
// it can't be fooled by an unrelated error whose *message* happens to
// contain the word "redirect" (e.g. a headless-Chromium "Too many
// redirects" failure), which the old check turned into a false 401 that
// never reached Sentry.
const REDIRECT_DIGEST_PREFIX = 'NEXT_REDIRECT;'

function isNextRedirectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.startsWith(REDIRECT_DIGEST_PREFIX)
}

export type ApiErrorOptions = {
  /**
   * Extra Sentry tags for the 500 branch, e.g. `{ area: 'reports', format: 'pdf' }`.
   * `route` and `method` are derived from `request` and don't need repeating.
   */
  tags?: Record<string, string | undefined>
  /**
   * Body for the 500 response, for routes whose client reads a specific shape
   * (a `success: false` flag, a localized message). `eventId` is always merged
   * in. Defaults to `{ error: 'Internal Server Error' }`.
   */
  body?: Record<string, unknown>
}

/**
 * Shared `catch` handler for the JSON route handlers under `/api`.
 *
 * Route handlers have two failure modes that look identical from the outside
 * but are not: an expected authorization outcome (403/401), and a genuine bug
 * (500). Every route used to hand-roll the same block and funnel the second
 * case into a bare `{ error: 'Internal Server Error' }` plus a
 * `console.error`: on Vercel that means the stack lands in a log stream
 * nobody is watching. Worse, `onRequestError`/`captureRequestError` only sees
 * errors Next.js itself surfaces, so an error a route *catches* never reaches
 * Sentry at all. The backend was, in practice, unmonitored.
 *
 * So: unexpected errors go to Sentry, and the returned event id goes back in
 * the response body. Whoever hits the failure can read the id off the response
 * and look it up directly.
 *
 * The 403/401 branches deliberately do NOT report. `requireRole` throws on
 * every unauthorized request and `getAuthContext` redirects every logged-out
 * one; paging on those would bury the real signal.
 */
export function handleApiError(
  error: unknown,
  request?: Request,
  options?: ApiErrorOptions,
): NextResponse {
  if (error instanceof ForbiddenError)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (isNextRedirectError(error))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `Request.url` is always absolute, so this cannot throw.
  const route = request ? maskPath(new URL(request.url).pathname) : undefined

  const eventId = Sentry.captureException(error, {
    // Caller tags first: `route` and `method` are derived here and are the
    // authoritative values, so a caller can add dimensions but not overwrite
    // the two everything else is grouped by.
    tags: { ...options?.tags, route, method: request?.method },
  })

  // Also logged, not only reported: in `pnpm dev` Sentry is not initialized
  // at all, and in production the Vercel log is where you land when you
  // already have the request open in front of you.
  console.error('API error:', { route, eventId }, error)

  return NextResponse.json(
    { ...(options?.body ?? { error: 'Internal Server Error' }), eventId },
    { status: 500 },
  )
}

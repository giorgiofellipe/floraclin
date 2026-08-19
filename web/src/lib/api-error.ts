import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ForbiddenError } from './errors'

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
// `NEXT_REDIRECT;` (same file). Checking the digest directly reproduces
// `isRedirectError` exactly, and unlike a substring match on the message,
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

// Path segments that identify a row (or, worse, authorize one) must never
// reach Sentry. `/api/anamnesis/token/<token>` carries a live access token in
// the URL and `/api/patients/<uuid>` carries a health-linked identifier;
// neither is filtered by `sendDefaultPii: false`, because an explicit tag is
// not "default PII". Masking also gives the tag the shape you actually want to
// group by: one `/api/patients/:id` rather than one tag value per patient.
//
// The test is inverted on purpose. Every static segment in `src/app/api` is
// kebab-case lowercase (verified against the directory tree), so anything that
// is not gets masked, and an allowlist fails safe in a way a blocklist of id
// shapes does not. Long all-hex runs are the one kebab-shaped exception:
// `randomBytes(32).toString('hex')` would otherwise pass as a word.
const STATIC_SEGMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const LONG_HEX = /^[0-9a-f]{16,}$/

function maskedRoute(request?: Request): string | undefined {
  if (!request) return undefined
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    // A malformed request URL is not worth losing the error report over.
    return undefined
  }

  return pathname
    .split('/')
    .map(segment => {
      if (!segment) return segment
      return STATIC_SEGMENT.test(segment) && !LONG_HEX.test(segment) ? segment : ':id'
    })
    .join('/')
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

  const route = maskedRoute(request)

  const eventId = Sentry.captureException(error, {
    // Caller tags first: `route` and `method` are derived here and are the
    // authoritative values, so a caller can add dimensions but not overwrite
    // the two everything else is grouped by.
    tags: { ...options?.tags, route, method: request?.method },
  })

  // Kept for `pnpm dev`, where Sentry is not initialized at all and this is
  // the only place the stack shows up.
  console.error('API error:', { route, eventId }, error)

  return NextResponse.json(
    { ...(options?.body ?? { error: 'Internal Server Error' }), eventId },
    { status: 500 },
  )
}

/**
 * Report a failure from a side effect that is deliberately allowed to fail
 * without failing the request: a Google Calendar push sync, a WhatsApp webhook
 * step, a background classification.
 *
 * Swallowing these is the right call, since none of them should cost the user
 * the operation they actually asked for. Swallowing them *silently* is not:
 * every one of these used to be a `console.error`, and a Vercel log stream is
 * not somewhere anyone looks. A push sync that has been failing for a week is
 * the kind of thing a clinic reports to us, rather than the other way round.
 */
export function reportSideEffectFailure(
  error: unknown,
  context: { area: string; step: string; extra?: Record<string, unknown> },
): void {
  Sentry.captureException(error, {
    tags: { area: context.area, step: context.step },
    extra: context.extra,
  })
}

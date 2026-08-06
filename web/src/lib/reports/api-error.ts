import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

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
// `isRedirectError` exactly, and unlike the substring match this
// replaces, it can't be fooled by an unrelated error whose *message* happens
// to contain the word "redirect" (e.g. a headless-Chromium "Too many
// redirects" failure in the PDF branch), which the old check turned into a
// false 401 that never reached Sentry.
const REDIRECT_DIGEST_PREFIX = 'NEXT_REDIRECT;'

function isNextRedirectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.startsWith(REDIRECT_DIGEST_PREFIX)
}

/**
 * Shared `catch` handler for every route under `/api/reports`.
 *
 * These routes have two failure modes that look identical from the outside
 * but are not: an expected authorization outcome (403/401), and a genuine
 * bug (500). Previously all eight routes hand-rolled the same block and
 * funnelled the third case into a bare `{ error: 'Internal Server Error' }`
 * plus a `console.error` — which on Vercel means the stack lands in a log
 * stream nobody is watching, and the operator holding the failing request
 * has nothing to correlate against. A PDF route that 500s is exactly the
 * case where the real exception matters and is exactly the case where it
 * was being thrown away.
 *
 * So: unexpected errors go to Sentry, and the returned event id goes back
 * in the response body. Whoever hits the failure can read the id off the
 * response and look it up directly.
 *
 * The 403/401 branches deliberately do NOT report — `requireRole` throws on
 * every unauthorized request, and paging on those would bury the real
 * signal.
 */
export function reportRouteError(error: unknown, request?: Request): NextResponse {
  const msg = error instanceof Error ? error.message : ''
  if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (isNextRedirectError(error))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `format` is the single most useful discriminator here: the JSON and PDF
  // branches of these routes share auth and the data query but diverge
  // completely afterwards, so knowing which one blew up narrows it to
  // headless-Chromium rendering vs everything else immediately.
  let route: string | undefined
  let format: string | undefined
  if (request) {
    try {
      const url = new URL(request.url)
      route = url.pathname
      format = url.searchParams.get('format') ?? 'json'
    } catch {
      // A malformed request URL is not worth losing the error report over.
    }
  }

  const eventId = Sentry.captureException(error, {
    tags: { area: 'reports', route, format },
  })

  console.error('Report API error:', { route, format, eventId }, error)

  return NextResponse.json({ error: 'Internal Server Error', eventId }, { status: 500 })
}

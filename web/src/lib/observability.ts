import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent } from '@sentry/nextjs'

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
 *
 * Lives here rather than next to `handleApiError` so that domain modules can
 * report without importing `next/server`.
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

/**
 * Sentry cron monitor config for a Vercel cron.
 *
 * `schedule` must mirror the entry in `web/vercel.json`, and the timezone is
 * `Etc/UTC` because Vercel evaluates cron expressions in UTC: tell Sentry
 * anything else and it reports every run as late. `checkinMargin` and
 * `maxRuntime` are minutes, so a run has an hour of slack before it counts as
 * missed and ten minutes before it counts as hung.
 */
export function cronMonitorConfig(schedule: string) {
  return {
    schedule: { type: 'crontab', value: schedule },
    timezone: 'Etc/UTC',
    checkinMargin: 60,
    maxRuntime: 10,
  } as const
}

// Path segments that identify a row (or, worse, authorize one) must never
// reach Sentry. `/api/anamnesis/token/<token>` carries a live access token in
// the URL and `/api/patients/<uuid>` a health-linked identifier; neither is
// filtered by `sendDefaultPii: false`, because a URL is not "default PII".
// Masking also gives the route tag the shape you actually want to group by:
// one `/api/patients/:id` rather than one tag value per patient.
//
// The test is inverted on purpose, and it is deliberately strict: every static
// segment in `src/app/api` is kebab-case, lowercase, and contains no digit
// (verified against the directory tree), so anything else is masked. An
// allowlist fails safe in a way a blocklist of id shapes does not, which is
// exactly how an earlier version of this let through a uuid that happened to
// start with a letter.
const STATIC_SEGMENT = /^[a-z]+(-[a-z]+)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function maskPath(pathname: string): string {
  return pathname
    .split('/')
    .map(segment => {
      if (!segment) return segment
      return STATIC_SEGMENT.test(segment) && !UUID.test(segment) ? segment : ':id'
    })
    .join('/')
}

// Query parameters that are credentials or contact details in this app:
// the password-reset and magic-link tokens, the e-mail they are addressed to,
// and the OAuth exchange code.
const SENSITIVE_PARAMS = new Set([
  'token',
  'code',
  'email',
  'secret',
  'key',
  'signature',
  'password',
  'access_token',
  'state',
])

/**
 * Mask identifiers in a URL: the path through {@link maskPath}, and the value
 * of any sensitive query parameter.
 */
export function scrubUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://placeholder.invalid')
  } catch {
    return url
  }

  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_PARAMS.has(key.toLowerCase())) parsed.searchParams.set(key, ':masked')
  }

  const masked = maskPath(parsed.pathname) + (parsed.search || '')
  return url.startsWith('/') ? masked : parsed.origin + masked
}

/**
 * `beforeSend` for both SDKs.
 *
 * The browser SDK copies `window.location.href` onto every event, and the
 * server SDK attaches the request URL. Neither is covered by
 * `sendDefaultPii: false`, so a render error on
 * `/reset-password?token=<live>&email=<person>` would ship a working
 * credential and a real e-mail address to Sentry, and a failure on
 * `/api/anamnesis/token/<token>` would ship the anamnesis link.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url)
  if (event.request?.query_string) delete event.request.query_string

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (typeof crumb.data?.url === 'string') crumb.data.url = scrubUrl(crumb.data.url)
      if (typeof crumb.data?.to === 'string') crumb.data.to = scrubUrl(crumb.data.to)
      if (typeof crumb.data?.from === 'string') crumb.data.from = scrubUrl(crumb.data.from)
    }
  }

  return event
}

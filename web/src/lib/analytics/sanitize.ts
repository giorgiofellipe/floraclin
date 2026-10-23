import { maskPath } from '@/lib/observability'

/**
 * posthog-js copies the page URL, path and referrer onto every event (and
 * the initial ones onto the person via `$set_once`). In this app a URL can
 * carry an e-mail (`/api/auth/confirm?email=`), a live token
 * (`/reset-password?token=`), an OAuth `code`, or a patient id in the path.
 *
 * Query strings are reduced to an allowlist (UTM parameters only), the
 * fragment is dropped, and path segments that are not plain lowercase words
 * become `:id` (same rule as Sentry's scrubbing, see `maskPath`).
 */
const KEPT_QUERY_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'])

export function sanitizeUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value, 'https://placeholder.invalid')
  } catch {
    return ''
  }

  const kept = new URLSearchParams()
  for (const [key, paramValue] of parsed.searchParams) {
    if (KEPT_QUERY_PARAMS.has(key.toLowerCase())) kept.append(key, paramValue)
  }
  const search = kept.toString()
  const path = maskPath(parsed.pathname) + (search ? `?${search}` : '')
  const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(value)
  return isRelative ? path : parsed.origin + path
}

// Every place posthog-js puts a URL or path. `$referring_domain` and `$host`
// are hosts only and stay.
const URL_PROPERTIES = new Set([
  '$current_url',
  '$pathname',
  '$referrer',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_referrer',
  '$prev_pageview_pathname',
  '$prev_pageview_url',
  '$session_entry_url',
  '$session_entry_pathname',
  '$session_entry_referrer',
  '$external_click_url',
])

// `title` is document.title, which a page may build from a record's name.
const DROPPED_PROPERTIES = new Set(['title', '$title'])

export function sanitizeEventProperties<T extends Record<string, unknown>>(properties: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (DROPPED_PROPERTIES.has(key)) continue
    if (URL_PROPERTIES.has(key) && typeof value === 'string') {
      // posthog-js uses '$direct' for "no referrer"; it is not a URL.
      out[key] = value.startsWith('$') ? value : sanitizeUrl(value)
    } else if ((key === '$set' || key === '$set_once') && value && typeof value === 'object') {
      out[key] = sanitizeEventProperties(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out as T
}

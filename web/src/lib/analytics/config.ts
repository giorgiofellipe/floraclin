/**
 * PostHog configuration, from env vars only. With no key everything in
 * `@/lib/analytics` is a no-op: the browser never downloads posthog-js and the
 * server never constructs a client.
 *
 * Read at call time rather than captured in module constants, so tests can
 * set and clear the vars. `NEXT_PUBLIC_*` is still inlined into the client
 * bundle at build time because each is referenced by its literal name.
 */
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

export interface AnalyticsConfig {
  key: string
  host: string
}

function hostOrDefault(host: string | undefined): string {
  const trimmed = host?.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_POSTHOG_HOST
}

/** The browser's config: the public project key (phc_...). */
export function clientAnalyticsConfig(): AnalyticsConfig | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  if (!key) return null
  return { key, host: hostOrDefault(process.env.NEXT_PUBLIC_POSTHOG_HOST) }
}

/**
 * The server's config. `POSTHOG_KEY` may point server events at another
 * project; it defaults to the public key, which is all capture needs.
 */
export function serverAnalyticsConfig(): AnalyticsConfig | null {
  const key = (process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY)?.trim()
  if (!key) return null
  return { key, host: hostOrDefault(process.env.NEXT_PUBLIC_POSTHOG_HOST) }
}

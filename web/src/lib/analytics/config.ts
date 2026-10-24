/**
 * PostHog configuration, from env vars only. With no key everything in
 * `@/lib/analytics` is a no-op: the browser never downloads posthog-js and the
 * server never constructs a client.
 *
 * `NEXT_PUBLIC_*` is inlined into the client bundle at build time only because
 * each is referenced by its literal name.
 */
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

interface AnalyticsConfig {
  key: string
  host: string
}

function hostOrDefault(host: string | undefined): string {
  const trimmed = host?.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_POSTHOG_HOST
}

/** The public project key (phc_...), used by both SDKs. */
export function analyticsConfig(): AnalyticsConfig | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  if (!key) return null
  return { key, host: hostOrDefault(process.env.NEXT_PUBLIC_POSTHOG_HOST) }
}

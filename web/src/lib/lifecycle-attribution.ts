import { getAppUrl } from '@/lib/app-url'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import type { LifecycleChannel } from '@/db/queries/lifecycle'
import type { LifecycleMessageKey } from '@/lib/lifecycle-messages'

const PRODUCTION_ALLOWED_HOSTS = new Set(['app.floraclin.com.br', 'floraclin.com.br'])

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function isAllowedLifecycleDestination(url: URL): boolean {
  if (PRODUCTION_ALLOWED_HOSTS.has(url.hostname)) return true
  return process.env.NODE_ENV !== 'production' && (isLocalhost(url.hostname) || url.hostname.endsWith('.test'))
}

export function lifecycleDestination(input: string, base = getAppUrl()): URL {
  const url = new URL(input, base)
  if (!isAllowedLifecycleDestination(url)) {
    throw new Error(`Lifecycle destination host is not allowed: ${url.hostname}`)
  }
  return url
}

export function addLifecycleUtmParams(
  destination: URL,
  opts: { sendId: string; messageKey: string; channel: LifecycleChannel },
): URL {
  const url = new URL(destination.toString())
  url.searchParams.set('utm_source', 'lifecycle')
  url.searchParams.set('utm_medium', opts.channel)
  url.searchParams.set('utm_campaign', opts.messageKey)
  url.searchParams.set('lc', opts.sendId)
  return url
}

export function lifecycleClickUrl(
  opts: { sendId: string; messageKey: string; channel: LifecycleChannel; destination: string },
  base = getAppUrl(),
): string {
  const destination = addLifecycleUtmParams(lifecycleDestination(opts.destination, base), opts)
  const click = new URL('/api/lifecycle/click', base)
  click.searchParams.set('lc', opts.sendId)
  click.searchParams.set('to', destination.toString())
  click.searchParams.set('utm_source', 'lifecycle')
  click.searchParams.set('utm_medium', opts.channel)
  click.searchParams.set('utm_campaign', opts.messageKey)
  return click.toString()
}

export function lifecycleDestinationForMessage(
  opts: { sendId: string; messageKey: string; channel: LifecycleChannel },
  base = getAppUrl(),
): URL | null {
  const message = LIFECYCLE_MESSAGES.find((item) => item.key === (opts.messageKey as LifecycleMessageKey))
  if (!message?.button) return null
  return addLifecycleUtmParams(lifecycleDestination(message.button.path, base), opts)
}

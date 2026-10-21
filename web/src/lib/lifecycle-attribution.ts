import { getAppUrl } from '@/lib/app-url'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import type { LifecycleChannel } from '@/db/queries/lifecycle'

export function lifecycleClickUrl(sendId: string): string {
  const url = new URL('/api/lifecycle/click', getAppUrl())
  url.searchParams.set('lc', sendId)
  return url.toString()
}

export function lifecycleDestination(send: { messageKey: string; channel: LifecycleChannel }): URL {
  const path = LIFECYCLE_MESSAGES.find((m) => m.key === send.messageKey)?.button?.path ?? '/'
  const appUrl = getAppUrl()
  const url = new URL(path, appUrl)
  // External buttons (the support WhatsApp) go out as written: their query
  // string is someone else's API.
  if (url.origin !== new URL(appUrl).origin) return url
  url.searchParams.set('utm_source', 'lifecycle')
  url.searchParams.set('utm_medium', send.channel)
  url.searchParams.set('utm_campaign', send.messageKey)
  return url
}

// Mail security gateways open every link right after delivery; a human click takes longer.
const SCANNER_GRACE_MS = 60_000
const SCANNER_USER_AGENT = /safelinks|mimecast|proofpoint|barracuda|facebookexternalhit|bot\b|crawler|spider|headless|python-requests|curl\//i

export function isLikelyLinkScanner(userAgent: string | null, sentAt: Date | null, now = new Date()): boolean {
  if (!userAgent || SCANNER_USER_AGENT.test(userAgent)) return true
  return sentAt !== null && now.getTime() - sentAt.getTime() < SCANNER_GRACE_MS
}

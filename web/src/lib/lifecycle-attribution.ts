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

// Mail security gateways (Defender/Safe Links, Proofpoint, Mimecast,
// Barracuda) open links in email on their own. They are recognised only by
// what the request itself says: a scanner user agent, a HEAD request, or a
// prefetch/preview. Time since the send is not a signal: people tap within
// seconds, especially on a phone notification.
//
// WhatsApp sends are never filtered: WhatsApp has no gateway that follows
// template buttons, and a missed real tap costs more than a counted preview.
//
// `bot` only as a whole word or a product token (`Googlebot/2.1`), so phone
// models such as CUBOT are not caught. The image-proxy tokens only matter if
// this URL ever ends up in an <img>.
const SCANNER_USER_AGENT =
  /safelinks|microsoft office (existence|protocol) discovery|ms-office|mimecast|proofpoint|barracuda|googleimageproxy|ggpht\.com|facebookexternalhit|\bbot\b|bot\/|crawler|spider|headless|python-requests|go-http-client|curl\/|wget\//i
// A prefetched redirect may be served from cache when the person then clicks,
// so treating a prefetch as a scanner can cost that click; no webmail
// prefetches links today, and counting every prefetch would cost more.
const NON_HUMAN_PURPOSE = /prefetch|prerender|preview/i

export type LifecycleClickRequest = {
  method: string
  userAgent: string | null
  // Sec-Purpose (Chromium, Firefox), Purpose (older Chromium), X-Purpose (Safari, `preview`), X-Moz (old Firefox).
  prefetchHeader: string | null
}

export function lifecycleClickRequest(request: { method: string; headers: Headers }): LifecycleClickRequest {
  const h = request.headers
  return {
    method: request.method,
    userAgent: h.get('user-agent'),
    prefetchHeader: h.get('sec-purpose') ?? h.get('purpose') ?? h.get('x-purpose') ?? h.get('x-moz'),
  }
}

export function isLikelyLinkScanner(req: LifecycleClickRequest, send: { channel: LifecycleChannel }): boolean {
  if (send.channel !== 'email') return false
  if (req.method === 'HEAD') return true
  if (req.prefetchHeader && NON_HUMAN_PURPOSE.test(req.prefetchHeader)) return true
  return !req.userAgent || SCANNER_USER_AGENT.test(req.userAgent)
}

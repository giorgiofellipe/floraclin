import { hasMarketingConsent } from '@/lib/cookie-consent'

export const DEFAULT_META_PIXEL_ID = '1651713926600603'

declare global {
  interface Window {
    fbq?: ((command: string, eventName: string, params?: Record<string, unknown>, options?: Record<string, unknown>) => void) & {
      callMethod?: (...args: unknown[]) => void
      queue?: unknown[]
      loaded?: boolean
      version?: string
      push?: (...args: unknown[]) => void
    }
    _fbq?: Window['fbq']
  }
}

const META_PIXEL_READY_RETRY_INTERVAL_MS = 100
const META_PIXEL_READY_RETRY_ATTEMPTS = 50

export function metaPixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID || DEFAULT_META_PIXEL_ID
}

export function generateMetaEventId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${random}`
}

export function trackMetaEvent(
  eventName: string,
  params: Record<string, unknown> = {},
  eventId?: string,
): void {
  trackMetaEventWhenReady(eventName, params, eventId, META_PIXEL_READY_RETRY_ATTEMPTS)
}

function trackMetaEventWhenReady(
  eventName: string,
  params: Record<string, unknown>,
  eventId: string | undefined,
  attemptsRemaining: number,
): void {
  if (!hasMarketingConsent()) return
  if (typeof window === 'undefined') return

  if (typeof window.fbq === 'function') {
    window.fbq('track', eventName, params, eventId ? { eventID: eventId } : undefined)
    return
  }

  if (attemptsRemaining <= 0) return

  window.setTimeout(() => {
    trackMetaEventWhenReady(eventName, params, eventId, attemptsRemaining - 1)
  }, META_PIXEL_READY_RETRY_INTERVAL_MS)
}

export function buildFbc(fbclid: string, clickedAt = Date.now()): string {
  return `fb.1.${clickedAt}.${fbclid}`
}

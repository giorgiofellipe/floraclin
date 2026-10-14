import { hasMarketingConsent } from "@/lib/cookie-consent"

export const DEFAULT_META_PIXEL_ID = '1651713926600603'
export const SIGNUP_URL = 'https://app.floraclin.com.br/signup'

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

export function metaPixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID || DEFAULT_META_PIXEL_ID
}

export function trackMetaEvent(eventName: string): void {
  if (!hasMarketingConsent()) return
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  window.fbq('track', eventName)
}

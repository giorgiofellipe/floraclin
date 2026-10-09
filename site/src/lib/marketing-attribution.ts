import { hasMarketingConsent } from "@/lib/cookie-consent"

export const DEFAULT_META_PIXEL_ID = '1651713926600603'

const ATTRIBUTION_STORAGE_KEY = 'floraclin_first_touch_attribution'
const PENDING_ATTRIBUTION_SESSION_KEY = 'floraclin_pending_first_touch_attribution'
const ATTRIBUTION_COOKIE_NAME = 'floraclin_ft'
const ATTRIBUTION_TTL_DAYS = 90
const ATTRIBUTION_PARAM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'] as const

type AttributionParamKey = (typeof ATTRIBUTION_PARAM_KEYS)[number]

interface SignupAttribution {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  fbclid?: string
  gclid?: string
  fbc?: string
  landingUrl?: string
  referrer?: string
  capturedAt: string
  expiresAt: string
}

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

const FIELD_BY_PARAM: Record<AttributionParamKey, keyof SignupAttribution> = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
  fbclid: 'fbclid',
  gclid: 'gclid',
}

export function metaPixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID || DEFAULT_META_PIXEL_ID
}

export function trackMetaEvent(eventName: string): void {
  if (!hasMarketingConsent()) return
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  window.fbq('track', eventName)
}

export function captureFirstTouchAttribution(): void {
  if (typeof window === 'undefined') return
  if (!hasMarketingConsent()) {
    capturePendingFirstTouchAttribution()
    return
  }
  if (readStoredAttribution()) return

  const attribution = readPendingAttribution() ?? attributionFromCurrentPage()
  if (!attribution) return

  writeStoredAttribution(attribution)
  clearPendingAttribution()
}

export function capturePendingFirstTouchAttribution(): void {
  if (typeof window === 'undefined' || readStoredAttribution() || readPendingAttribution()) return

  const attribution = attributionFromCurrentPage()
  if (!attribution) return

  try {
    window.sessionStorage.setItem(PENDING_ATTRIBUTION_SESSION_KEY, JSON.stringify(attribution))
  } catch {
    // Optional storage can be blocked; pre-consent attribution is best effort.
  }
}

export function discardMarketingAttribution(): void {
  clearPendingAttribution()
  clearStoredAttribution()
}

function attributionFromCurrentPage(): SignupAttribution | null {
  const params = new URLSearchParams(window.location.search)
  if (!ATTRIBUTION_PARAM_KEYS.some((key) => params.has(key))) return null

  const now = new Date()
  const attribution: SignupAttribution = {
    capturedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    landingUrl: window.location.href,
  }

  for (const key of ATTRIBUTION_PARAM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) attribution[FIELD_BY_PARAM[key]] = value.slice(0, 500)
  }

  if (document.referrer) attribution.referrer = document.referrer.slice(0, 1000)
  if (attribution.fbclid) attribution.fbc = `fb.1.${now.getTime()}.${attribution.fbclid}`

  return attribution
}

function writeStoredAttribution(attribution: SignupAttribution): void {
  const value = JSON.stringify(attribution)
  try {
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, value)
  } catch {
    // localStorage can be blocked; the first-party cookie below is enough for cross-subdomain signup attribution.
  }

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  const domain =
    window.location.hostname === 'floraclin.com.br' || window.location.hostname.endsWith('.floraclin.com.br')
      ? '; Domain=.floraclin.com.br'
      : ''
  document.cookie = `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${ATTRIBUTION_TTL_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}${domain}`
}

function readStoredAttribution(): SignupAttribution | null {
  const cookie = readCookie(ATTRIBUTION_COOKIE_NAME)
  const stored = cookie ?? safeLocalStorage()
  if (!stored) return null

  try {
    const parsed = JSON.parse(stored) as SignupAttribution
    return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
  } catch {
    return null
  }
}

function readPendingAttribution(): SignupAttribution | null {
  try {
    const stored = window.sessionStorage.getItem(PENDING_ATTRIBUTION_SESSION_KEY)
    if (!stored) return null

    const parsed = JSON.parse(stored) as SignupAttribution
    return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
  } catch {
    return null
  }
}

function readCookie(name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function safeLocalStorage(): string | null {
  try {
    return window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)
  } catch {
    return null
  }
}

function clearPendingAttribution(): void {
  try {
    window.sessionStorage.removeItem(PENDING_ATTRIBUTION_SESSION_KEY)
  } catch {
    // Optional storage can be blocked.
  }
}

function clearStoredAttribution(): void {
  try {
    window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY)
  } catch {
    // Best effort cleanup; an expired cookie is enough to stop server capture.
  }
  const domain =
    window.location.hostname === 'floraclin.com.br' || window.location.hostname.endsWith('.floraclin.com.br')
      ? '; Domain=.floraclin.com.br'
      : ''
  document.cookie = `${ATTRIBUTION_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax${domain}`
}

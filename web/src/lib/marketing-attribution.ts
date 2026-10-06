import { hasMarketingConsent } from '@/lib/cookie-consent'

export const DEFAULT_META_PIXEL_ID = '1651713926600603'

export const ATTRIBUTION_STORAGE_KEY = 'floraclin_first_touch_attribution'
export const ATTRIBUTION_COOKIE_NAME = 'floraclin_ft'
export const ATTRIBUTION_TTL_DAYS = 90

const ATTRIBUTION_PARAM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
] as const

type AttributionParamKey = (typeof ATTRIBUTION_PARAM_KEYS)[number]
type SignupAttributionStringKey = Exclude<keyof SignupAttribution, 'capturedAt' | 'expiresAt'>

export interface SignupAttribution {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  fbclid?: string
  gclid?: string
  fbp?: string
  fbc?: string
  landingUrl?: string
  referrer?: string
  capturedAt: string
  expiresAt: string
  metaEventId?: string
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

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function readStoredAttribution(): SignupAttribution | null {
  if (typeof window === 'undefined') return null

  const fromCookie = parseStoredAttribution(readCookie(ATTRIBUTION_COOKIE_NAME))
  if (fromCookie) return fromCookie

  try {
    return parseStoredAttribution(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY))
  } catch {
    return null
  }
}

export function captureFirstTouchAttribution(): SignupAttribution | null {
  if (typeof window === 'undefined') return null
  if (!hasMarketingConsent()) return null

  const existing = readStoredAttribution()
  if (existing) return existing

  const params = new URLSearchParams(window.location.search)
  if (!ATTRIBUTION_PARAM_KEYS.some((key) => params.has(key))) return null

  const now = new Date()
  const expiresAt = new Date(now.getTime() + ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const attribution: SignupAttribution = {
    capturedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    landingUrl: window.location.href,
  }

  for (const key of ATTRIBUTION_PARAM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) attribution[FIELD_BY_PARAM[key]] = value.slice(0, 500)
  }

  if (document.referrer) attribution.referrer = document.referrer.slice(0, 1000)
  if (attribution.fbclid) attribution.fbc = buildFbc(attribution.fbclid, now.getTime())

  writeStoredAttribution(attribution)
  return attribution
}

export function attributionForSignup(metaEventId: string): SignupAttribution | null {
  const stored = readStoredAttribution()
  if (!stored) return null

  const fbp = readCookie('_fbp')
  const fbc = readCookie('_fbc') ?? stored.fbc

  return {
    ...stored,
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    metaEventId,
  }
}

export function parseSignupAttribution(value: FormDataEntryValue | null): SignupAttribution | null {
  if (typeof value !== 'string' || !value) return null
  return normalizeAttribution(value)
}

function parseStoredAttribution(value: string | null): SignupAttribution | null {
  if (!value) return null
  const parsed = normalizeAttribution(value)
  if (!parsed) return null
  if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
    clearStoredAttribution()
    return null
  }
  return parsed
}

function normalizeAttribution(value: string): SignupAttribution | null {
  try {
    const raw = JSON.parse(value) as Partial<SignupAttribution>
    if (!raw.capturedAt || !raw.expiresAt) return null

    const attribution: SignupAttribution = {
      capturedAt: trimString(raw.capturedAt, 40) ?? new Date().toISOString(),
      expiresAt: trimString(raw.expiresAt, 40) ?? new Date(Date.now() + ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    }

    copyString(raw, attribution, 'utmSource', 500)
    copyString(raw, attribution, 'utmMedium', 500)
    copyString(raw, attribution, 'utmCampaign', 500)
    copyString(raw, attribution, 'utmContent', 500)
    copyString(raw, attribution, 'utmTerm', 500)
    copyString(raw, attribution, 'fbclid', 500)
    copyString(raw, attribution, 'gclid', 500)
    copyString(raw, attribution, 'fbp', 500)
    copyString(raw, attribution, 'fbc', 500)
    copyString(raw, attribution, 'landingUrl', 1000)
    copyString(raw, attribution, 'referrer', 1000)
    copyString(raw, attribution, 'metaEventId', 120)

    return attribution
  } catch {
    return null
  }
}

function copyString(
  raw: Partial<SignupAttribution>,
  target: SignupAttribution,
  key: SignupAttributionStringKey,
  max: number,
): void {
  const value = trimString(raw[key], max)
  if (value) {
    target[key] = value
  }
}

function trimString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function writeStoredAttribution(attribution: SignupAttribution): void {
  const value = JSON.stringify(attribution)
  try {
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, value)
  } catch {
    // Safari private windows and hardened browsers can block localStorage.
  }

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  const domain = cookieDomain(window.location.hostname)
  document.cookie = `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${ATTRIBUTION_TTL_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}${domain}`
}

function clearStoredAttribution(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY)
  } catch {
    // Best effort cleanup; an expired cookie is enough to stop server capture.
  }
  const domain = cookieDomain(window.location.hostname)
  document.cookie = `${ATTRIBUTION_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax${domain}`
}

function cookieDomain(hostname: string): string {
  if (hostname === 'floraclin.com.br' || hostname.endsWith('.floraclin.com.br')) {
    return '; Domain=.floraclin.com.br'
  }
  return ''
}

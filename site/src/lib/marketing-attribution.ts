import { hasMarketingConsent } from "@/lib/cookie-consent"

export const DEFAULT_META_PIXEL_ID = '1651713926600603'
export const SIGNUP_URL = 'https://app.floraclin.com.br/signup'

const ATTRIBUTION_STORAGE_KEY = 'floraclin_first_touch_attribution'
const ATTRIBUTION_CLIENT_COOKIE_NAME = 'floraclin_ft_client'
export const ATTRIBUTION_COOKIE_NAME = 'floraclin_ft'
export const ATTRIBUTION_TTL_DAYS = 90
const ATTRIBUTION_PARAM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'] as const
const ATTRIBUTION_LINK_PARAM_KEYS = [...ATTRIBUTION_PARAM_KEYS, 'landing_path', 'referrer'] as const

type AttributionParamKey = (typeof ATTRIBUTION_PARAM_KEYS)[number]
type AttributionLinkParamKey = (typeof ATTRIBUTION_LINK_PARAM_KEYS)[number]
type SignupAttributionStringKey = Exclude<keyof SignupAttribution, 'capturedAt' | 'expiresAt'>

export interface SignupAttribution {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  fbclid?: string
  gclid?: string
  landingUrl?: string
  landingPath?: string
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

const FIELD_BY_LINK_PARAM: Record<AttributionLinkParamKey, keyof SignupAttribution> = {
  ...FIELD_BY_PARAM,
  landing_path: 'landingPath',
  referrer: 'referrer',
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

  const attribution = attributionFromCurrentPage()
  if (!attribution) return

  writeStoredAttribution(mergeFirstTouchAttribution(readStoredAttribution(), attribution))
}

export function signupUrlWithPendingAttribution(): string {
  if (typeof window === 'undefined') return SIGNUP_URL

  const attribution = readStoredAttribution() ?? attributionFromCurrentPage()
  if (!attribution) return SIGNUP_URL

  const url = new URL(SIGNUP_URL)
  for (const key of ATTRIBUTION_LINK_PARAM_KEYS) {
    const value = attribution[FIELD_BY_LINK_PARAM[key]]
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

export function discardMarketingAttribution(): void {
  // First-party signup attribution is strictly necessary for signup reporting
  // and remains available when optional marketing storage is declined.
}

function attributionFromCurrentPage(): SignupAttribution | null {
  return attributionFromUrl(new URL(window.location.href), document.referrer)
}

export function attributionFromUrl(url: URL, referrer?: string | null, capturedAt = new Date()): SignupAttribution | null {
  const params = url.searchParams
  const attribution: SignupAttribution = {
    capturedAt: capturedAt.toISOString(),
    expiresAt: new Date(capturedAt.getTime() + ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    landingUrl: url.toString(),
    landingPath: url.pathname,
  }

  for (const key of ATTRIBUTION_PARAM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) attribution[FIELD_BY_PARAM[key]] = value.slice(0, 500)
  }

  const landingPathParam = params.get('landing_path')?.trim()
  const referrerParam = params.get('referrer')?.trim()
  if (landingPathParam) attribution.landingPath = landingPathParam.slice(0, 1000)
  if (referrerParam || referrer) attribution.referrer = (referrerParam || referrer || '').slice(0, 1000)

  return attribution
}

export function mergeFirstTouchAttribution(
  existing: SignupAttribution | null,
  incoming: SignupAttribution,
): SignupAttribution {
  if (!existing) return incoming

  const merged: SignupAttribution = { ...existing }
  copyMissing(incoming, merged, 'utmSource')
  copyMissing(incoming, merged, 'utmMedium')
  copyMissing(incoming, merged, 'utmCampaign')
  copyMissing(incoming, merged, 'utmContent')
  copyMissing(incoming, merged, 'utmTerm')
  copyMissing(incoming, merged, 'fbclid')
  copyMissing(incoming, merged, 'gclid')
  copyMissing(incoming, merged, 'landingUrl')
  copyMissing(incoming, merged, 'landingPath')
  copyMissing(incoming, merged, 'referrer')
  return merged
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
  document.cookie = `${ATTRIBUTION_CLIENT_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${ATTRIBUTION_TTL_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}${domain}`
}

function readStoredAttribution(): SignupAttribution | null {
  const cookie = readCookie(ATTRIBUTION_CLIENT_COOKIE_NAME)
  const stored = cookie ?? safeLocalStorage()
  return parseStoredAttribution(stored)
}

export function parseStoredAttribution(value: string | null | undefined): SignupAttribution | null {
  if (!value) return null
  const parsed = normalizeAttribution(value)
  if (!parsed) return null
  return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
}

function normalizeAttribution(value: string): SignupAttribution | null {
  return normalizeAttributionJson(value) ?? normalizeAttributionJson(safeDecodeURIComponent(value))
}

function normalizeAttributionJson(value: string): SignupAttribution | null {
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
    copyString(raw, attribution, 'landingUrl', 1000)
    copyString(raw, attribution, 'landingPath', 1000)
    copyString(raw, attribution, 'referrer', 1000)

    return attribution
  } catch {
    return null
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
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

function copyString(
  raw: Partial<SignupAttribution>,
  target: SignupAttribution,
  key: SignupAttributionStringKey,
  max: number,
): void {
  const value = trimString(raw[key], max)
  if (value) target[key] = value
}

function trimString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function copyMissing(source: SignupAttribution, target: SignupAttribution, key: SignupAttributionStringKey): void {
  if (!target[key] && source[key]) target[key] = source[key]
}

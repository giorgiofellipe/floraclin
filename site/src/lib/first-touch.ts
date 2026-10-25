import type { NextRequest, NextResponse } from 'next/server'

// Same cookie, shape and rules as web/src/lib/first-touch.ts: both apps write
// it on .floraclin.com.br and the app's signup action reads what this one wrote.
export const FIRST_TOUCH_COOKIE = 'floraclin_ft'
const OWN_DOMAIN = 'floraclin.com.br'
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60
// Keeps the encoded cookie well under the browser's 4 KB limit, past which it is dropped silently.
const MAX_PARAM_LENGTH = 200
const MAX_PATH_LENGTH = 300

const UTM_FIELDS = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
} as const

const CLICK_ID_FIELDS = {
  fbclid: 'fbclid',
  gclid: 'gclid',
} as const

type UtmField = (typeof UTM_FIELDS)[keyof typeof UTM_FIELDS]
type ClickIdField = (typeof CLICK_ID_FIELDS)[keyof typeof CLICK_ID_FIELDS]

/**
 * One visit, kept whole. UTMs, path and an external referrer origin are stored
 * for signup reporting, ad click ids for the Meta conversion events.
 */
export type FirstTouch = Partial<Record<UtmField | ClickIdField, string>> & {
  landingPath: string
  referrer?: string
  capturedAt: string
}

export function touchFromUrl(
  url: URL,
  referer: string | null,
  capturedAt = new Date(),
): FirstTouch {
  const touch: FirstTouch = {
    landingPath: url.pathname.slice(0, MAX_PATH_LENGTH),
    capturedAt: capturedAt.toISOString(),
  }
  copyParams(url.searchParams, UTM_FIELDS, touch)
  copyParams(url.searchParams, CLICK_ID_FIELDS, touch)
  const referrer = externalOrigin(referer, url.hostname)
  if (referrer) touch.referrer = referrer
  return touch
}

export function hasCampaignSignal(touch: FirstTouch): boolean {
  return [...Object.values(UTM_FIELDS), ...Object.values(CLICK_ID_FIELDS)].some((field) => touch[field])
}

/** A later visit replaces the stored one only when it brings the first campaign signal. */
export function chooseFirstTouch(existing: FirstTouch | null, incoming: FirstTouch): FirstTouch {
  if (!existing) return incoming
  if (!hasCampaignSignal(existing) && hasCampaignSignal(incoming)) return incoming
  return existing
}

export function parseFirstTouch(value: string | undefined): FirstTouch | null {
  if (!value) return null
  try {
    const raw = JSON.parse(value) as Record<string, unknown>
    if (typeof raw.landingPath !== 'string' || typeof raw.capturedAt !== 'string') return null
    const touch: FirstTouch = {
      landingPath: raw.landingPath.slice(0, MAX_PATH_LENGTH),
      capturedAt: raw.capturedAt,
    }
    for (const field of [...Object.values(UTM_FIELDS), ...Object.values(CLICK_ID_FIELDS), 'referrer'] as const) {
      const fieldValue = raw[field]
      if (typeof fieldValue === 'string' && fieldValue) touch[field] = fieldValue.slice(0, MAX_PARAM_LENGTH)
    }
    return touch
  } catch {
    return null
  }
}

/** Writes the first-touch cookie on document requests, only when its value changes. */
export function captureFirstTouch(request: NextRequest, response: NextResponse): void {
  if (request.method !== 'GET' || !isDocumentRequest(request)) return

  const stored = parseFirstTouch(request.cookies.get(FIRST_TOUCH_COOKIE)?.value)
  const next = chooseFirstTouch(stored, touchFromUrl(request.nextUrl, request.headers.get('referer')))
  if (stored && JSON.stringify(next) === JSON.stringify(stored)) return

  const onOwnDomain = isOwnHost(request.nextUrl.hostname)
  response.cookies.set(FIRST_TOUCH_COOKIE, JSON.stringify(next), {
    maxAge: MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    httpOnly: true,
    ...(onOwnDomain ? { domain: `.${OWN_DOMAIN}` } : {}),
  })
}

function isDocumentRequest(request: NextRequest): boolean {
  const destination = request.headers.get('sec-fetch-dest')
  if (destination) return destination === 'document'
  return !request.headers.has('rsc') && (request.headers.get('accept') ?? '').includes('text/html')
}

function copyParams<F extends string>(
  params: URLSearchParams,
  fields: Record<string, F>,
  touch: Partial<Record<F, string>>,
): void {
  for (const [param, field] of Object.entries(fields)) {
    const value = params.get(param)?.trim()
    if (value) touch[field] = value.slice(0, MAX_PARAM_LENGTH)
  }
}

function externalOrigin(referer: string | null, currentHost: string): string | undefined {
  if (!referer) return undefined
  try {
    const url = new URL(referer)
    return isOwnHost(url.hostname) || url.hostname === currentHost ? undefined : url.origin
  } catch {
    return undefined
  }
}

function isOwnHost(hostname: string): boolean {
  return hostname === OWN_DOMAIN || hostname.endsWith(`.${OWN_DOMAIN}`)
}

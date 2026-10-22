import type { NextRequest, NextResponse } from 'next/server'
import { REFERRAL_COOKIE_MAX_AGE_DAYS, REFERRAL_COOKIE_NAME, normalizeReferralCode } from '@/lib/referral-rules'

// Same cookie and rules in web/src/lib/referral/cookie.ts and site/src/lib/referral-cookie.ts:
// the site writes it on .floraclin.com.br and the app's signup action reads it.
const OWN_DOMAIN = 'floraclin.com.br'
const MAX_AGE_SECONDS = REFERRAL_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60

const REFERRAL_PATH = /^\/indicacao\/([^/]+)\/?$/

/** Code from `?ref=` or a `/indicacao/{CODE}` path. Normalised; null when absent/malformed. */
export function referralCodeFromUrl(url: URL): string | null {
  const fromPath = REFERRAL_PATH.exec(url.pathname)?.[1]
  return normalizeReferralCode(fromPath ?? url.searchParams.get('ref'))
}

/**
 * On a GET document request with the switch on and a valid code in the URL, sets floraclin_ref.
 * Last link wins: it overwrites, and skips the write only when the stored value is identical.
 */
export function captureReferralCode(
  request: NextRequest,
  response: NextResponse,
  env: Record<string, string | undefined> = process.env,
): void {
  if (request.method !== 'GET' || !isDocumentRequest(request)) return
  if (env.REFERRAL_ENROLLMENT_ENABLED !== 'true') return

  const code = referralCodeFromUrl(request.nextUrl)
  if (!code) return
  if (request.cookies.get(REFERRAL_COOKIE_NAME)?.value === code) return

  response.cookies.set(REFERRAL_COOKIE_NAME, code, {
    maxAge: MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    httpOnly: true,
    ...(isOwnHost(request.nextUrl.hostname) ? { domain: `.${OWN_DOMAIN}` } : {}),
  })
}

function isDocumentRequest(request: NextRequest): boolean {
  const destination = request.headers.get('sec-fetch-dest')
  if (destination) return destination === 'document'
  return !request.headers.has('rsc') && (request.headers.get('accept') ?? '').includes('text/html')
}

function isOwnHost(hostname: string): boolean {
  return hostname === OWN_DOMAIN || hostname.endsWith(`.${OWN_DOMAIN}`)
}

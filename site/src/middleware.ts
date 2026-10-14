import { NextResponse, type NextRequest } from 'next/server'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_TTL_DAYS,
  attributionFromUrl,
  mergeFirstTouchAttribution,
  parseStoredAttribution,
} from '@/lib/marketing-attribution'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  captureSignupAttribution(request, response)
  return response
}

function captureSignupAttribution(request: NextRequest, response: NextResponse): void {
  if (request.method !== 'GET') return

  const accept = request.headers.get('accept') ?? ''
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return

  const incoming = attributionFromUrl(request.nextUrl, request.headers.get('referer'))
  if (!incoming) return

  const existing = parseStoredAttribution(request.cookies.get(ATTRIBUTION_COOKIE_NAME)?.value)
  const attribution = mergeFirstTouchAttribution(existing, incoming)
  const domain = cookieDomain(request.nextUrl.hostname)

  response.cookies.set(ATTRIBUTION_COOKIE_NAME, JSON.stringify(attribution), {
    maxAge: ATTRIBUTION_TTL_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    httpOnly: true,
    ...(domain ? { domain } : {}),
  })
}

function cookieDomain(hostname: string): string | undefined {
  if (hostname === 'floraclin.com.br' || hostname.endsWith('.floraclin.com.br')) {
    return '.floraclin.com.br'
  }
  return undefined
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}

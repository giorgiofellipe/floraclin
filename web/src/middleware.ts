import { auth } from '@/lib/auth-config'
import { NextResponse, type NextRequest } from 'next/server'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_PARAM_KEYS,
  ATTRIBUTION_TTL_DAYS,
  attributionFromUrl,
  mergeFirstTouchAttribution,
  parseStoredAttribution,
} from '@/lib/marketing-attribution'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isAuthenticated = !!req.auth

  // Test auth bypass
  if (
    process.env.TEST_AUTH_BYPASS_ENABLED === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const testUserId = req.headers.get('x-test-user-id')
    if (testUserId) return withSignupAttribution(req, NextResponse.next())
  }

  // Public routes — always allow
  if (
    pathname.startsWith('/c/') ||
    pathname.startsWith('/a/') ||
    pathname.startsWith('/sign/') ||
    pathname.startsWith('/verify/') ||
    // The confirmation link is opened from an inbox, often on a different
    // device with no session. Without this it falls through to the
    // unauthenticated /login redirect and the token in the query string is
    // lost, which defeats the whole point of a 24 hour link.
    pathname.startsWith('/confirm-email') ||
    pathname === '/manifest.webmanifest' ||
    // Sentry's browser SDK posts every client-side event to this tunnel
    // (tunnelRoute in next.config.ts). Without this an anonymous visitor on
    // /signup or /login gets a 307 to /login, the POST lands there as a 405,
    // and their errors never reach Sentry, which is exactly where we look
    // when the signup funnel breaks.
    pathname === '/monitoring' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return withSignupAttribution(req, NextResponse.next())
  }

  // Auth pages — redirect authenticated users appropriately
  if (pathname === '/login' || pathname === '/reset-password' || pathname === '/signup') {
    if (isAuthenticated) {
      const session = req.auth as any
      const tenantId = session?.tenantId as string | null

      if (!tenantId) return withSignupAttribution(req, NextResponse.redirect(new URL('/signup/clinic-details', req.url)))
      if (session?.emailVerified === false) return withSignupAttribution(req, NextResponse.redirect(new URL('/confirm-email', req.url)))
      return withSignupAttribution(req, NextResponse.redirect(new URL('/dashboard', req.url)))
    }
    return withSignupAttribution(req, NextResponse.next())
  }

  // Not authenticated — redirect to login
  if (!isAuthenticated) {
    return withSignupAttribution(req, NextResponse.redirect(new URL('/login', req.url)))
  }

  // Authenticated from here — read tenant info from session
  const session = req.auth as any
  const tenantId = session?.tenantId as string | null
  const isPlatformAdmin = session?.isPlatformAdmin as boolean

  // Platform admins can always access /admin routes regardless of tenant status
  if (pathname.startsWith('/admin')) {
    if (isPlatformAdmin) return withSignupAttribution(req, NextResponse.next())
    return withSignupAttribution(req, NextResponse.redirect(new URL('/dashboard', req.url)))
  }

  // No tenant membership — Google OAuth user who hasn't set up clinic
  if (!tenantId && !isPlatformAdmin) {
    if (pathname === '/signup/clinic-details') return withSignupAttribution(req, NextResponse.next())
    return withSignupAttribution(req, NextResponse.redirect(new URL('/signup/clinic-details', req.url)))
  }

  // Email not confirmed yet. Replaces the manual approval gate: the wait is
  // now the user's own inbox rather than someone clicking approve.
  //
  // Gated on an explicit `false`, never on falsy. Undefined means the token
  // predates the claim, and those are cleared by the version check above
  // before they ever reach this line.
  if (session?.emailVerified === false) {
    return withSignupAttribution(req, NextResponse.redirect(new URL('/confirm-email', req.url)))
  }

  return withSignupAttribution(req, NextResponse.next())
})

function withSignupAttribution(request: NextRequest, response: NextResponse): NextResponse {
  if (request.method !== 'GET') return response
  if (request.nextUrl.pathname.startsWith('/api/')) return response
  if (!request.nextUrl.pathname.startsWith('/signup') && !hasAttributionSignal(request)) return response

  const accept = request.headers.get('accept') ?? ''
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return response

  const incoming = attributionFromUrl(request.nextUrl, request.headers.get('referer'))
  if (!incoming) return response

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

  return response
}

function hasAttributionSignal(request: NextRequest): boolean {
  return ATTRIBUTION_PARAM_KEYS.some((key) => request.nextUrl.searchParams.get(key)?.trim()) ||
    Boolean(request.headers.get('referer')?.trim())
}

function cookieDomain(hostname: string): string | undefined {
  if (hostname === 'floraclin.com.br' || hostname.endsWith('.floraclin.com.br')) {
    return '.floraclin.com.br'
  }
  return undefined
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|face-templates|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

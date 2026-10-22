import { auth } from '@/lib/auth-config'
import { NextResponse } from 'next/server'
import { captureFirstTouch } from '@/lib/first-touch'
import { CALLBACK_URL_PARAM, safeCallbackPath } from '@/lib/callback-url'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isAuthenticated = !!req.auth

  // Test auth bypass
  if (
    process.env.TEST_AUTH_BYPASS_ENABLED === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const testUserId = req.headers.get('x-test-user-id')
    if (testUserId) return NextResponse.next()
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
    return NextResponse.next()
  }

  // Auth pages — redirect authenticated users appropriately
  if (pathname === '/login' || pathname === '/reset-password' || pathname === '/signup') {
    if (isAuthenticated) {
      const session = req.auth as any
      const tenantId = session?.tenantId as string | null

      if (!tenantId) return NextResponse.redirect(new URL('/signup/clinic-details', req.url))
      if (session?.emailVerified === false) return NextResponse.redirect(new URL('/confirm-email', req.url))
      // Already signed in on this browser (a link copied out of an in-app
      // browser, say): go where the link was going rather than the dashboard.
      const destination = pathname === '/login' ? safeCallbackPath(req.nextUrl.searchParams.get(CALLBACK_URL_PARAM)) : null
      return NextResponse.redirect(new URL(destination ?? '/dashboard', req.url))
    }
    // Not only /signup: people bounced to /login reach /signup through a
    // client-side link, which never makes a document request and so would
    // never be captured. Only UTMs, click ids and the bare path are kept, so
    // the reset token in /reset-password's query is never recorded.
    const response = NextResponse.next()
    captureFirstTouch(req, response)
    return response
  }

  // Not authenticated — redirect to login, carrying the destination so a
  // lifecycle link to /onboarding still lands there after sign-in. The UTMs
  // ride inside callbackUrl, not on /login itself, so record the first touch
  // on the redirect response, where they are still in the request URL.
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', req.url)
    const destination = safeCallbackPath(`${pathname}${req.nextUrl.search}`)
    if (destination) loginUrl.searchParams.set(CALLBACK_URL_PARAM, destination)
    const response = NextResponse.redirect(loginUrl)
    captureFirstTouch(req, response)
    return response
  }

  // Authenticated from here — read tenant info from session
  const session = req.auth as any
  const tenantId = session?.tenantId as string | null
  const isPlatformAdmin = session?.isPlatformAdmin as boolean
  const subscriptionStatus = session?.subscriptionStatus as string | null

  // Platform admins can always access /admin routes regardless of tenant status
  if (pathname.startsWith('/admin')) {
    if (isPlatformAdmin) return NextResponse.next()
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // No tenant membership — Google OAuth user who hasn't set up clinic
  if (!tenantId && !isPlatformAdmin) {
    if (pathname === '/signup/clinic-details') return NextResponse.next()
    return NextResponse.redirect(new URL('/signup/clinic-details', req.url))
  }

  // Email not confirmed yet. Replaces the manual approval gate: the wait is
  // now the user's own inbox rather than someone clicking approve.
  //
  // Gated on an explicit `false`, never on falsy. Undefined means the token
  // predates the claim, and those are cleared by the version check above
  // before they ever reach this line.
  if (session?.emailVerified === false) {
    return NextResponse.redirect(new URL('/confirm-email', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|face-templates|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

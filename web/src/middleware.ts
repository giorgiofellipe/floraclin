import { auth } from '@/lib/auth-config'
import { NextResponse } from 'next/server'

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
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return NextResponse.next()
  }

  // Stale JWT: minted before the claims below existed. Clear it and force a
  // re-login rather than reason about a token that cannot answer.
  if (isAuthenticated) {
    const token = req.auth as any
    if (!token?.v || token.v < 3) {
      const res = NextResponse.redirect(new URL('/login', req.url))
      res.cookies.delete('authjs.session-token')
      res.cookies.delete('__Secure-authjs.session-token')
      return res
    }
  }

  // Auth pages — redirect authenticated users appropriately
  if (pathname === '/login' || pathname === '/reset-password' || pathname === '/signup') {
    if (isAuthenticated) {
      const session = req.auth as any
      const tenantId = session?.tenantId as string | null

      if (!tenantId) return NextResponse.redirect(new URL('/signup/clinic-details', req.url))
      if (session?.emailVerified === false) return NextResponse.redirect(new URL('/confirm-email', req.url))
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    return NextResponse.next()
  }

  // Not authenticated — redirect to login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', req.url))
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

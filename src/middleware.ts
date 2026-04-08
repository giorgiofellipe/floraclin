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
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp)$/)
  ) {
    return NextResponse.next()
  }

  // Auth pages — redirect to dashboard if already logged in
  if (pathname === '/login' || pathname === '/reset-password') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    return NextResponse.next()
  }

  // Protected pages — redirect to login if not authenticated
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|face-templates|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

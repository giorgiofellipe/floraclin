import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Test auth bypass: when TEST_AUTH_BYPASS_ENABLED is set and the request
// includes x-test-user-id header, skip Supabase auth entirely.
// This is used by e2e tests running against a local Docker Postgres.
// Double guard: env var AND not production — prevents accidental bypass in prod
const TEST_AUTH_BYPASS =
  process.env.TEST_AUTH_BYPASS_ENABLED === 'true' &&
  process.env.NODE_ENV !== 'production'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // ── Test auth bypass ────────────────────────────────────────────
  if (TEST_AUTH_BYPASS) {
    const testUserId = request.headers.get('x-test-user-id')
    if (testUserId) {
      // Simulate authenticated user — skip Supabase entirely
      const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
        request.nextUrl.pathname.startsWith('/reset-password')

      if (isAuthRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }

      return supabaseResponse
    }
  }

  // ── Normal Supabase auth ────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users trying to access platform routes
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/reset-password')
  const isPublicRoute = request.nextUrl.pathname.startsWith('/c/') ||
    request.nextUrl.pathname.startsWith('/api/book/')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isOnboarding = request.nextUrl.pathname.startsWith('/onboarding')

  if (!user && !isAuthRoute && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth routes
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

// NOTE: Onboarding enforcement is handled in the (platform) layout.tsx
// (not in middleware, because we need DB access to check tenant settings).
// The platform layout checks tenant.settings.onboarding_completed and
// redirects to /onboarding if false. See Task 4.

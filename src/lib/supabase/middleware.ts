import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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

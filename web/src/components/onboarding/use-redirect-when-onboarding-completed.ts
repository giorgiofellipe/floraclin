import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Back can show the wizard from the router cache or the bfcache without a server
 * request, so the page's server redirect never runs; this asks the server again.
 * `onRedirect` runs just before leaving (the wizard stops abandon tracking: a
 * finished wizard sent on is not an abandonment).
 */
export function useRedirectWhenOnboardingCompleted(onRedirect?: () => void) {
  const router = useRouter()
  const redirected = useRef(false)
  // A ref, so a new callback identity does not re-run the check.
  const onRedirectRef = useRef(onRedirect)
  useEffect(() => {
    onRedirectRef.current = onRedirect
  }, [onRedirect])

  useEffect(() => {
    const controller = new AbortController()

    async function check() {
      if (redirected.current) return
      try {
        const res = await fetch('/api/onboarding', { cache: 'no-store', signal: controller.signal })
        if (!res.ok) return
        const data = await res.json()
        if (data?.completed !== true || redirected.current || controller.signal.aborted) return
        redirected.current = true
        onRedirectRef.current?.()
        router.replace('/dashboard')
      } catch {
        // Offline or aborted: stay on the wizard.
      }
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check()
    }

    void check()
    window.addEventListener('pageshow', onPageShow)
    return () => {
      controller.abort()
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [router])
}

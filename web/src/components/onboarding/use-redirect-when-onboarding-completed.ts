import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Sends the owner to the dashboard if onboarding is already completed.
 * Back navigation can show the wizard from the router cache or the bfcache
 * without a server request, so the page's server redirect never runs; this
 * asks the server again on mount and on a bfcache restore. Only an explicit
 * `completed: true` redirects: an error leaves the owner on the wizard.
 */
export function useRedirectWhenOnboardingCompleted() {
  const router = useRouter()
  const redirected = useRef(false)

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

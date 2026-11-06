'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { withoutEmailConfirmedParam } from '@/lib/email-confirmed-toast'

/**
 * After the confirmation link signs the owner in, the banner just disappears;
 * this says why, once. `show` comes from the page's `email_confirmed=1`, which
 * is dropped from the URL right after the toast.
 *
 * The root layout renders <Toaster> before the page, so it is already listening
 * when this effect runs, even on a full page load.
 *
 * The parameter goes with history.replaceState, not router.replace, so the
 * server page is not rendered again. Next patches replaceState to keep
 * useSearchParams in sync, but on a full page load the router installs that
 * patch in its own effect, which runs after this one (parents after children).
 * Calling it in the same commit would bypass the router, which would keep the
 * old URL and could put the parameter back on its next refresh. Hence the next
 * task. No cleanup cancels it: under StrictMode the second effect run is a
 * no-op, so cancelling would drop the only call.
 */
export function EmailConfirmedToast({ show }: { show: boolean }) {
  const shown = useRef(false)

  useEffect(() => {
    if (!show || shown.current) return
    shown.current = true
    toast.success('E-mail confirmado.')
    setTimeout(() => {
      window.history.replaceState(window.history.state, '', withoutEmailConfirmedParam(new URL(window.location.href)))
    }, 0)
  }, [show])

  return null
}

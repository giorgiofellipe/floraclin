'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { withoutEmailConfirmedParam } from '@/lib/email-confirmed-toast'

/**
 * After the confirmation link signs the owner in, the banner just disappears;
 * this says why, once. `show` comes from the page's `email_confirmed=1`, which
 * is dropped from the URL straight away.
 */
export function EmailConfirmedToast({ show }: { show: boolean }) {
  const router = useRouter()
  const shown = useRef(false)

  useEffect(() => {
    if (!show || shown.current) return
    shown.current = true
    toast.success('E-mail confirmado.')
    router.replace(withoutEmailConfirmedParam(new URL(window.location.href)), { scroll: false })
  }, [show, router])

  return null
}

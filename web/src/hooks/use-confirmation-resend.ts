'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CONFIRM_RESEND_COOLDOWN_MS } from '@/lib/confirm-resend-cooldown'

const RESEND_FAILED = 'Não foi possível reenviar o link agora.'

/**
 * Resends the confirmation link for `email`, then holds the button for the
 * cooldown. Shared by the confirm-email page and the in-app banner.
 */
export function useConfirmationResend(email: string) {
  const [cooldown, setCooldown] = useState(0)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  function resend() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/confirm/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        if (!res.ok) {
          toast.error(RESEND_FAILED)
          return
        }
        // Not "reenviado". The endpoint answers 200 for an unknown address,
        // an already-confirmed one and a throttled one alike, so it cannot
        // tell us an email actually went out, and claiming one did sends a
        // throttled user to wait on an inbox that will stay empty.
        toast.success('Se houver um link a enviar, ele chega em instantes.')
        setCooldown(CONFIRM_RESEND_COOLDOWN_MS / 1000)
      } catch {
        toast.error(RESEND_FAILED)
      }
    })
  }

  return { resend, cooldown, isPending, disabled: isPending || cooldown > 0 }
}

'use client'

import { useEffect, useState, useTransition } from 'react'
import { MailIcon } from 'lucide-react'
import { toast } from 'sonner'

const RESEND_COOLDOWN_SECONDS = 60

interface EmailConfirmationBannerProps {
  email: string
  className?: string
}

/**
 * Shown to an owner who signed up with a password and has not confirmed the
 * address. Non-blocking: everything but the sends listed in
 * lib/email-confirmation-gate.ts works meanwhile, and the copy says which.
 */
export function EmailConfirmationBanner({ email, className = '' }: EmailConfirmationBannerProps) {
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
          toast.error('Não foi possível reenviar o link agora.')
          return
        }
        // The endpoint answers alike when throttled, so it cannot promise a send.
        toast.success('Se houver um link a enviar, ele chega em instantes.')
        setCooldown(RESEND_COOLDOWN_SECONDS)
      } catch {
        toast.error('Não foi possível reenviar o link agora.')
      }
    })
  }

  return (
    <div
      role="status"
      data-testid="email-confirmation-banner"
      className={`flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="flex items-start gap-2">
        <MailIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Confirme seu e-mail <strong className="break-all">{email}</strong> para enviar mensagens por WhatsApp,
          convidar sua equipe e assinar um plano.
        </span>
      </p>
      <button
        type="button"
        onClick={resend}
        disabled={isPending || cooldown > 0}
        className="shrink-0 self-start rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 sm:self-auto"
      >
        {cooldown > 0 ? `Reenviar link (${cooldown}s)` : isPending ? 'Enviando...' : 'Reenviar link'}
      </button>
    </div>
  )
}

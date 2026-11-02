'use client'

import { MailIcon } from 'lucide-react'
import { useConfirmationResend } from '@/hooks/use-confirmation-resend'

function resendLabel(cooldown: number, isPending: boolean): string {
  if (cooldown > 0) return `Reenviar link (${cooldown}s)`
  if (isPending) return 'Enviando...'
  return 'Reenviar link'
}

/**
 * Shown to an owner who signed up with a password and has not confirmed the
 * address. Non-blocking: everything but the sends listed in
 * lib/email-confirmation-gate.ts works meanwhile, and the copy says which.
 */
export function EmailConfirmationBanner({ email }: { email: string }) {
  const { resend, cooldown, isPending, disabled } = useConfirmationResend(email)

  return (
    // A landmark, not a live region: the copy never changes, and a status
    // role would be announced on every page load of the platform layout.
    <div
      role="region"
      aria-label="Confirmação de e-mail pendente"
      data-testid="email-confirmation-banner"
      className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
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
        disabled={disabled}
        className="shrink-0 self-start rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 sm:self-auto"
      >
        {resendLabel(cooldown, isPending)}
      </button>
    </div>
  )
}

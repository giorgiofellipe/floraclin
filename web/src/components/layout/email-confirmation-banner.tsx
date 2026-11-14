'use client'

import { MailIcon } from 'lucide-react'
import { useConfirmationResend } from '@/hooks/use-confirmation-resend'

export function resendLabel(cooldown: number, isPending: boolean): string {
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
      // One row at every width: on phones the short copy sits beside the
      // button instead of stacking over it.
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <p className="flex min-w-0 items-start gap-2">
        <MailIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {/* Phones: one short sentence, the address left to the title and to
            screen readers. */}
        <span data-testid="email-confirmation-short" className="min-w-0 text-xs sm:hidden" title={email}>
          Confirme seu e-mail<span className="sr-only"> {email}</span> para liberar WhatsApp, convites e planos.
        </span>
        <span data-testid="email-confirmation-full" className="hidden min-w-0 sm:inline">
          {/* The address stays on one line, cut with an ellipsis when it does
              not fit; the full one is in the title and in the text screen
              readers get. */}
          Confirme seu e-mail{' '}
          <strong title={email} className="inline-block max-w-full truncate align-bottom">
            {email}
          </strong>{' '}
          para enviar mensagens por WhatsApp, convidar sua equipe e assinar um plano.
        </span>
      </p>
      <button
        type="button"
        onClick={resend}
        disabled={disabled}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 sm:min-h-9"
      >
        {resendLabel(cooldown, isPending)}
      </button>
    </div>
  )
}

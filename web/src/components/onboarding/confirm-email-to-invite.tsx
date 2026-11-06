'use client'

import { MailIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirmationResend } from '@/hooks/use-confirmation-resend'

function resendLabel(cooldown: number, isPending: boolean): string {
  if (cooldown > 0) return `Reenviar link (${cooldown}s)`
  if (isPending) return 'Enviando...'
  return 'Reenviar link'
}

export function ConfirmEmailToInvite({ email }: { email: string }) {
  const { resend, cooldown, isPending, disabled } = useConfirmationResend(email)

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2">
        <MailIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Confirme seu e-mail para convidar sua equipe.
      </p>
      <Button type="button" variant="outline" onClick={resend} disabled={disabled} className="h-11 shrink-0 sm:h-9">
        {resendLabel(cooldown, isPending)}
      </Button>
    </div>
  )
}

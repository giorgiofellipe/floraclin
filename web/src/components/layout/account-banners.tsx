'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MailIcon, X } from 'lucide-react'
import { EmailConfirmationBanner, resendLabel } from '@/components/layout/email-confirmation-banner'
import { SUBSCRIBE_HREF, SubscriptionBanner, TRIAL_URGENT_DAYS, trialDaysLeft } from '@/components/layout/subscription-banner'
import { useConfirmationResend } from '@/hooks/use-confirmation-resend'

interface AccountBannersProps {
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  subscriptionSource?: string | null
  /** The owner's address while it is unconfirmed; null once confirmed. */
  unconfirmedEmail: string | null
}

/**
 * A new clinic usually has a calm trial and an unconfirmed e-mail at once. Two
 * stacked bars pushed the first steps off the phone screen, so they share one
 * line. Urgent trial states keep their own bar.
 */
export function AccountBanners({ subscriptionStatus, currentPeriodEnd, subscriptionSource, unconfirmedEmail }: AccountBannersProps) {
  const daysLeft = trialDaysLeft(currentPeriodEnd)
  if (subscriptionStatus === 'trialing' && daysLeft > TRIAL_URGENT_DAYS && unconfirmedEmail) {
    return <TrialAndEmailLine daysLeft={daysLeft} email={unconfirmedEmail} />
  }
  return (
    <>
      <SubscriptionBanner subscriptionStatus={subscriptionStatus} currentPeriodEnd={currentPeriodEnd} subscriptionSource={subscriptionSource} />
      {unconfirmedEmail && <EmailConfirmationBanner email={unconfirmedEmail} />}
    </>
  )
}

function TrialAndEmailLine({ daysLeft, email }: { daysLeft: number; email: string }) {
  // Closing drops only the trial part; the e-mail reminder cannot be dismissed, as on its own bar.
  const [trialHidden, setTrialHidden] = useState(false)
  const { resend, cooldown, isPending, disabled } = useConfirmationResend(email)

  return (
    <div
      role="region"
      aria-label="Teste gratuito e confirmação de e-mail"
      data-testid="account-banner"
      className="flex items-center gap-3 border-b border-sage/20 bg-sage/10 px-4 py-1.5 text-sm text-forest"
    >
      <MailIcon className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-xs sm:text-sm">
        {!trialHidden && <>Teste gratuito · {daysLeft} dias. </>}
        Confirme seu e-mail<span className="sr-only"> {email}</span> para liberar WhatsApp, convites e planos.{' '}
        {!trialHidden && (
          <Link href={SUBSCRIBE_HREF} className="hidden font-medium underline underline-offset-2 hover:opacity-80 sm:inline">
            Ver planos
          </Link>
        )}
      </p>
      <button
        type="button"
        onClick={resend}
        disabled={disabled}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-sage/30 bg-white px-3 text-xs font-medium text-forest transition-colors hover:bg-sage/10 disabled:opacity-60 sm:min-h-9"
      >
        {resendLabel(cooldown, isPending)}
      </button>
      {!trialHidden && (
        <button
          type="button"
          onClick={() => setTrialHidden(true)}
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded hover:bg-sage/20 sm:size-9"
          aria-label="Fechar aviso do teste gratuito"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

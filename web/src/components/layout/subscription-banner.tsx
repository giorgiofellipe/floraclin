'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { differenceInDays } from 'date-fns'

interface SubscriptionBannerProps {
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
}

export function SubscriptionBanner({ subscriptionStatus, currentPeriodEnd }: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (!subscriptionStatus || subscriptionStatus === 'active' || subscriptionStatus === 'canceled') {
    return null
  }

  if (subscriptionStatus === 'trialing') {
    if (dismissed) return null

    const daysLeft = currentPeriodEnd
      ? Math.max(0, differenceInDays(new Date(currentPeriodEnd), new Date()))
      : 0

    return (
      <div className="flex items-center justify-between gap-3 border-b border-sage/20 bg-sage/10 px-4 py-2 text-sm text-forest">
        <p>
          Teste gratuito · {daysLeft} {daysLeft === 1 ? 'dia restante' : 'dias restantes'}.{' '}
          <Link href="/configuracoes?tab=billing" className="font-medium underline underline-offset-2 hover:opacity-80">
            Ver planos
          </Link>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-0.5 hover:bg-sage/20 transition-colors"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  if (subscriptionStatus === 'expired') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
        <p>
          Seu período de teste expirou. Assine um plano para continuar usando WhatsApp e outros recursos.
        </p>
        <Link
          href="/configuracoes?tab=billing"
          className="shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
        >
          Assinar agora
        </Link>
      </div>
    )
  }

  if (subscriptionStatus === 'past_due') {
    return (
      <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
        <p>
          Pagamento pendente. Atualize seu método de pagamento para evitar interrupção.
        </p>
      </div>
    )
  }

  return null
}

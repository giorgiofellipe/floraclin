'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { brCalendarDaysBetween } from '@/lib/dates'
import { ExportDataLink } from '@/components/layout/export-data-dialog'

interface SubscriptionBannerProps {
  /** The effective status (see `effectiveSubscriptionStatus`): a trial or
   *  grant past its end arrives here as `expired`, even before the cron. */
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  subscriptionSource?: string | null
}

const SUBSCRIBE_HREF = '/configuracoes?tab=assinatura'

function formatBrTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

function SubscribeButton({ tone }: { tone: 'red' | 'amber' }) {
  const color =
    tone === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
  return (
    <Link
      href={SUBSCRIBE_HREF}
      className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium text-white transition-colors ${color}`}
    >
      Assinar agora
    </Link>
  )
}

export function SubscriptionBanner({ subscriptionStatus, currentPeriodEnd, subscriptionSource }: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (!subscriptionStatus || subscriptionStatus === 'active') {
    return null
  }

  if (subscriptionStatus === 'trialing') {
    // BR calendar days, so "termina hoje" means the trial ends on today's
    // date in São Paulo, whatever the hour.
    const daysLeft = currentPeriodEnd
      ? Math.max(0, brCalendarDaysBetween(new Date(), new Date(currentPeriodEnd)))
      : 0

    if (daysLeft === 0) {
      return (
        <div
          role="status"
          data-testid="trial-banner-last-day"
          className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <p>
            Seu teste gratuito termina hoje
            {currentPeriodEnd ? `, às ${formatBrTime(currentPeriodEnd)}` : ''}. Assine para não
            perder o acesso à agenda, aos pacientes e ao WhatsApp.
          </p>
          <SubscribeButton tone="red" />
        </div>
      )
    }

    if (daysLeft <= 3) {
      return (
        <div
          role="status"
          data-testid="trial-banner-ending"
          className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <p>
            Seu teste gratuito termina em {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}. Assine para
            continuar usando a agenda, os pacientes e o WhatsApp sem interrupção.
          </p>
          <SubscribeButton tone="amber" />
        </div>
      )
    }

    if (dismissed) return null

    return (
      <div className="flex items-center justify-between gap-3 border-b border-sage/20 bg-sage/10 px-4 py-2 text-sm text-forest">
        <p>
          Teste gratuito · {daysLeft} dias restantes.{' '}
          <Link href={SUBSCRIBE_HREF} className="font-medium underline underline-offset-2 hover:opacity-80">
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
    // A gift or admin grant that ran out arrives here too; only a trial
    // should be told its trial ended.
    const isTrial = !subscriptionSource || subscriptionSource === 'trial'
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
      >
        <p>
          {isTrial ? 'Seu período de teste expirou.' : 'Sua assinatura terminou.'} Você está no modo
          leitura: assine um plano para voltar a usar o WhatsApp e criar novos agendamentos, pacientes
          e lançamentos. <ExportDataLink className="font-medium underline underline-offset-2 hover:opacity-80" />
        </p>
        <SubscribeButton tone="red" />
      </div>
    )
  }

  if (subscriptionStatus === 'past_due') {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
      >
        <p>
          Pagamento pendente. Atualize seu método de pagamento para evitar interrupção.
        </p>
        <Link
          href={SUBSCRIBE_HREF}
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
        >
          Atualizar pagamento
        </Link>
      </div>
    )
  }

  if (subscriptionStatus === 'canceled') {
    // The status stays 'canceled' after the period closes, so the same value
    // means two different things to the user: still paid up, or shut out.
    const stillPaidUp = currentPeriodEnd ? new Date(currentPeriodEnd) > new Date() : false

    if (!stillPaidUp) {
      return (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <p>
            Sua assinatura terminou. Assine um plano para voltar a usar o WhatsApp e criar novos
            agendamentos, pacientes e lançamentos.
          </p>
          <SubscribeButton tone="red" />
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
        <p>
          Sua assinatura foi cancelada. Você mantém acesso até o fim do período contratado.
        </p>
        <Link
          href={SUBSCRIBE_HREF}
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
        >
          Reativar
        </Link>
      </div>
    )
  }

  return null
}

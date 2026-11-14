'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { PLANS_HREF } from '@/lib/billing-links'
import { formatBrDayMonth } from '@/lib/dates'
import { DEFAULT_CREDIT_COST, MARKETING_CREDIT_COST, UNLIMITED_CREDITS } from '@/lib/whatsapp-credits'

interface WhatsAppCreditBarProps {
  used: number
  total: number
  periodEnd: string
  /** Set while the clinic is on a trial: the credits stop there, not at `periodEnd`. */
  trialEnd?: string | null
}

function PlansLink({ tone }: { tone: 'red' | 'sage' }) {
  return (
    <Link
      href={PLANS_HREF}
      className={`inline-flex min-h-11 items-center gap-1 text-xs font-medium whitespace-nowrap sm:min-h-0 ${
        tone === 'red' ? 'text-red-700 hover:text-red-900' : 'text-sage hover:text-forest'
      }`}
    >
      Ver planos
      <ArrowUpRight className="size-3" />
    </Link>
  )
}

function renewalLabel(periodEnd: string, trialEnd: string | null | undefined): string | null {
  if (trialEnd && (!periodEnd || new Date(trialEnd) < new Date(periodEnd))) {
    return `Válidos até o fim do teste, em ${formatBrDayMonth(trialEnd)}`
  }
  return periodEnd ? `Renovam em ${formatBrDayMonth(periodEnd)}` : null
}

export function WhatsAppCreditBar({ used, total, periodEnd, trialEnd }: WhatsAppCreditBarProps) {
  const unlimited = total === UNLIMITED_CREDITS

  if (total === 0) {
    return (
      <div className="rounded-[3px] border border-topbar-border bg-white p-4 space-y-2">
        <p className="text-sm font-medium text-charcoal">Seu plano não inclui créditos de WhatsApp</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p className="text-xs text-mid">
            Sem créditos, as mensagens automáticas e os envios pelo FloraClin ficam pausados. Escolha um plano com créditos para liberar.
          </p>
          <PlansLink tone="sage" />
        </div>
      </div>
    )
  }

  const percentage = unlimited ? 0 : Math.min((used / total) * 100, 100)
  const exhausted = !unlimited && used >= total
  const marketingBlocked = !unlimited && !exhausted && total - used < MARKETING_CREDIT_COST
  const usageLabel = unlimited
    ? `${used} créditos usados (ilimitado)`
    : `${used} de ${total} créditos usados`
  const renewal = renewalLabel(periodEnd, trialEnd)

  const barColor =
    percentage >= 100
      ? 'bg-red-500'
      : percentage >= 90
        ? 'bg-red-400'
        : percentage >= 70
          ? 'bg-amber-400'
          : 'bg-sage'

  return (
    <div className="rounded-[3px] border border-topbar-border bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-charcoal">
          {exhausted ? 'Créditos esgotados' : usageLabel}
        </span>
        {renewal && <span className="text-xs text-mid">{renewal}</span>}
      </div>

      {!unlimited && (
        <div className="h-2 w-full rounded-full bg-content-bg overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      <p className="text-xs text-mid">
        Cada mensagem enviada usa {DEFAULT_CREDIT_COST} crédito. Templates de marketing, como aniversário e reativação, usam {MARKETING_CREDIT_COST}.
      </p>

      {marketingBlocked && (
        <p className="text-xs text-amber-dark">
          Créditos insuficientes para templates de marketing.
        </p>
      )}

      {exhausted && (
        <div className="flex items-center gap-2 rounded-[3px] bg-red-50 border border-red-200 px-3 py-2">
          <p className="flex-1 text-xs text-red-700">
            Seus créditos de WhatsApp acabaram neste período. Faça upgrade do plano para mais créditos.
          </p>
          <PlansLink tone="red" />
        </div>
      )}
    </div>
  )
}

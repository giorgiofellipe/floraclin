'use client'

import { ArrowUpRight } from 'lucide-react'
import { DEFAULT_CREDIT_COST, MARKETING_CREDIT_COST, UNLIMITED_CREDITS } from '@/lib/whatsapp-credits'

interface WhatsAppCreditBarProps {
  used: number
  total: number
  periodEnd: string
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  const end = new Date(dateStr)
  const diff = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function WhatsAppCreditBar({ used, total, periodEnd }: WhatsAppCreditBarProps) {
  const unlimited = total === UNLIMITED_CREDITS
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const exhausted = total > 0 && used >= total
  const marketingBlocked = total > 0 && !exhausted && total - used < MARKETING_CREDIT_COST
  const usageLabel = unlimited
    ? `${used} créditos usados (ilimitado)`
    : `${used} de ${total} créditos usados`
  const daysLeft = daysUntil(periodEnd)

  const barColor =
    percentage >= 100
      ? 'bg-red-500'
      : percentage >= 90
        ? 'bg-red-400'
        : percentage >= 70
          ? 'bg-amber-400'
          : 'bg-sage'

  return (
    <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-charcoal">
          {exhausted ? 'Créditos esgotados' : usageLabel}
        </span>
        {periodEnd && (
          <span className="text-xs text-mid">
            {daysLeft > 0
              ? `Renovam em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`
              : 'Renovam hoje'}
          </span>
        )}
      </div>

      {!unlimited && (
        <div className="h-2 w-full rounded-full bg-[#F4F6F8] overflow-hidden">
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
          <a
            href="/settings/billing"
            className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900 whitespace-nowrap"
          >
            Ver planos
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      )}
    </div>
  )
}

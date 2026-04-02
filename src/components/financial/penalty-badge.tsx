'use client'

import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'

interface PenaltyBadgeProps {
  fineAmount: number
  interestAmount: number
  isPaid?: boolean
  className?: string
}

export function PenaltyBadge({ fineAmount, interestAmount, isPaid, className }: PenaltyBadgeProps) {
  const total = fineAmount + interestAmount

  if (total <= 0 && !isPaid) return null

  if (isPaid && total <= 0) {
    return (
      <span
        data-testid="penalty-badge"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#F0F7F1] text-sage',
          className,
        )}
      >
        Encargos pagos
      </span>
    )
  }

  return (
    <span
      data-testid="penalty-badge"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700',
        className,
      )}
    >
      {fineAmount > 0 && <>Multa {formatCurrency(fineAmount)}</>}
      {fineAmount > 0 && interestAmount > 0 && ' + '}
      {interestAmount > 0 && <>Juros {formatCurrency(interestAmount)}</>}
    </span>
  )
}

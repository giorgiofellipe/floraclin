import { cn } from '@/lib/utils'
import { REFERRAL_MAX_COUNTING_FOR_DISCOUNT, referralDiscountPercent } from '@/lib/referral/rules'

/** 20% → 40% → … → GRÁTIS, with the steps already reached filled and the next one outlined. */
export function ReferralSteps({ counting }: { counting: number }) {
  const steps = Array.from({ length: REFERRAL_MAX_COUNTING_FOR_DISCOUNT }, (_, i) => i + 1)
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Etapas do desconto">
      {steps.map((n) => {
        const reached = counting >= n
        const isNext = counting + 1 === n
        const isLast = n === REFERRAL_MAX_COUNTING_FOR_DISCOUNT
        return (
          <li
            key={n}
            aria-current={isNext ? 'step' : undefined}
            className={cn(
              'rounded-lg border px-1 py-2.5 text-center',
              reached && 'border-sage bg-sage text-white',
              !reached && isNext && 'border-dashed border-sage text-sage',
              !reached && !isNext && 'border-topbar-border bg-white text-mid',
            )}
          >
            <span className={cn('block text-base font-semibold', isLast && !reached && 'text-[#E07A5F]')}>
              {isLast ? 'GRÁTIS' : `${referralDiscountPercent(n)}%`}
            </span>
            <span className="block text-[10px] leading-tight">
              {n} {n === 1 ? 'clínica' : 'clínicas'}
              {reached ? ' ✓' : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

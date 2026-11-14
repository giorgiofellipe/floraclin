'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatCurrency } from '@/lib/utils'
import { DUE_SOON_DAYS } from '@/lib/financial/receivables'

export type ReceivablesTotalKey = 'overdue' | 'dueSoon' | 'receivedThisMonth'

type Totals = Record<ReceivablesTotalKey, number>

const TILES: { key: ReceivablesTotalKey; label: string; amountClass: string }[] = [
  { key: 'overdue', label: 'Vencido', amountClass: 'text-red-700' },
  { key: 'dueSoon', label: `Vence em ${DUE_SOON_DAYS} dias`, amountClass: 'text-amber-dark' },
  { key: 'receivedThisMonth', label: 'Recebido no mês', amountClass: 'text-emerald-700' },
]

/** Each total is also the filter that lists the charges behind it. */
export function ReceivablesTotals({
  active,
  onSelect,
}: {
  active: ReceivablesTotalKey | null
  onSelect: (key: ReceivablesTotalKey) => void
}) {
  const { data } = useQuery<Totals>({
    queryKey: queryKeys.financial.receivablesTotals,
    queryFn: async () => {
      const res = await fetch('/api/financial/receivables-totals')
      if (!res.ok) throw new Error('Erro ao carregar totais')
      return res.json()
    },
  })

  return (
    <div className="grid grid-cols-3 gap-2" data-testid="receivables-totals">
      {TILES.map(({ key, label, amountClass }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(key)}
            className={cn(
              'min-h-11 rounded-lg border bg-white px-3 py-2 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] sm:px-4 sm:py-3',
              isActive ? 'border-sage/50 ring-1 ring-sage/25' : 'border-topbar-border hover:border-sage/25',
            )}
          >
            <span className="block text-[11px] leading-tight text-mid sm:text-xs">{label}</span>
            {data ? (
              <span className={cn('mt-0.5 block text-sm font-semibold tabular-nums sm:text-lg', amountClass)}>
                {formatCurrency(data[key])}
              </span>
            ) : (
              <Skeleton className="mt-1 h-5 w-20 sm:h-6" />
            )}
          </button>
        )
      })}
    </div>
  )
}

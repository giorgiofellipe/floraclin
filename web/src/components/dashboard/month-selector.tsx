'use client'

import { addMonths, format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseLocalDate } from '@/lib/dates'

interface MonthSelectorProps {
  /** Currently selected month, 'YYYY-MM'. */
  month: string
  /** The real current month, 'YYYY-MM' (navigating past it is disabled). */
  currentMonth: string
  onChange: (month: string) => void
}

export function MonthSelector({ month, currentMonth, onChange }: MonthSelectorProps) {
  const anchor = parseLocalDate(`${month}-01`)
  const label = format(anchor, "MMMM 'de' yyyy", { locale: ptBR })
  const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1)
  const isCurrentMonth = month === currentMonth

  const navigate = (direction: 'prev' | 'next') => {
    const next = direction === 'next' ? addMonths(anchor, 1) : subMonths(anchor, 1)
    onChange(format(next, 'yyyy-MM'))
  }

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-sage/20 bg-white px-1 py-1"
      data-testid="dashboard-month-selector"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-mid hover:bg-petal hover:text-forest transition-colors"
        onClick={() => navigate('prev')}
        aria-label="Mês anterior"
        data-testid="dashboard-month-prev"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-[120px] text-center text-[13px] font-medium capitalize text-[#2A2A2A]">
        {capitalizedLabel}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-mid hover:bg-petal hover:text-forest transition-colors"
        onClick={() => navigate('next')}
        disabled={isCurrentMonth}
        aria-label="Próximo mês"
        data-testid="dashboard-month-next"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

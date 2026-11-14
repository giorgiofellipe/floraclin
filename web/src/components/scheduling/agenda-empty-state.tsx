'use client'

import { CalendarPlusIcon, Link2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { cn } from '@/lib/utils'

interface AgendaEmptyStateProps {
  /** The clinic has never booked anything. */
  firstAppointment: boolean
  scope: 'day' | 'week' | 'month'
  bookingUrl: string | null
  onSchedule: (anchor: HTMLElement) => void
  className?: string
}

const SCOPE_TITLE = { day: 'Nenhum atendimento neste dia', week: 'Nenhum atendimento nesta semana', month: 'Nenhum atendimento neste mês' }

export function AgendaEmptyState({ firstAppointment, scope, bookingUrl, onSchedule, className }: AgendaEmptyStateProps) {
  async function copyBookingLink() {
    if (!bookingUrl) return
    try {
      await navigator.clipboard.writeText(bookingUrl)
      toast.success('Link de agendamento copiado')
    } catch {
      toast.error('Não foi possível copiar o link')
    }
  }

  return (
    <div
      className={cn('flex max-w-sm flex-col items-center gap-3 rounded-xl bg-white px-6 py-5 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)] ring-1 ring-topbar-border', className)}
      data-testid="agenda-empty-state"
    >
      <p className="text-[15px] font-semibold text-charcoal">{firstAppointment ? 'Sua agenda está vazia' : SCOPE_TITLE[scope]}</p>
      <p className="text-[13px] text-mid">
        {scope === 'month' ? 'Toque em um dia para ver os horários ou use + Agendar.' : 'Toque em um horário para agendar ou use + Agendar.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <ReadOnlyGuard label="Agendar">
          <Button className="bg-forest text-cream hover:bg-sage max-sm:h-11" onClick={(e) => onSchedule(e.currentTarget)} data-testid="agenda-empty-schedule">
            <CalendarPlusIcon className="size-4" data-icon="inline-start" />
            {firstAppointment ? 'Agendar primeiro atendimento' : 'Agendar'}
          </Button>
        </ReadOnlyGuard>
        {bookingUrl && (
          <Button variant="outline" className="max-sm:h-11" onClick={copyBookingLink} data-testid="agenda-empty-copy-link">
            <Link2Icon className="size-4" data-icon="inline-start" />
            Copiar link de agendamento online
          </Button>
        )}
      </div>
    </div>
  )
}

'use client'

import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_COLORS } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
}

interface AppointmentCardProps {
  appointment: AppointmentWithDetails
  compact?: boolean
  onClick?: (appointment: AppointmentWithDetails) => void
}

export function AppointmentCard({ appointment, compact = false, onClick }: AppointmentCardProps) {
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status] ?? 'bg-petal text-mid'
  const displayName = appointment.patientName ?? appointment.bookingName ?? 'Sem paciente'
  const timeStr = `${appointment.startTime.slice(0, 5)} - ${appointment.endTime.slice(0, 5)}`

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onClick?.(appointment)}
        className={cn(
          'w-full rounded-lg px-2 py-1 text-left text-xs transition-all duration-150 hover:shadow-sm hover:-translate-y-px',
          statusColor
        )}
      >
        <span className="font-semibold">{appointment.startTime.slice(0, 5)}</span>{' '}
        <span className="truncate">{displayName}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(appointment)}
      className={cn(
        'w-full h-full rounded-lg border-l-[3px] bg-white px-3 py-2 text-left shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        appointment.status === 'scheduled' && 'border-l-sage',
        appointment.status === 'confirmed' && 'border-l-mint',
        appointment.status === 'in_progress' && 'border-l-amber',
        appointment.status === 'completed' && 'border-l-mid',
        appointment.status === 'cancelled' && 'border-l-red-500',
        appointment.status === 'no_show' && 'border-l-amber-dark'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-charcoal">{displayName}</p>
          <p className="text-xs text-mid">{timeStr}</p>
          {appointment.procedureTypeName && (
            <p className="mt-0.5 truncate text-xs text-mid">
              {appointment.procedureTypeName}
            </p>
          )}
        </div>
        <Badge className={cn('shrink-0 rounded-full text-[10px] px-2 py-0.5', statusColor)}>
          {STATUS_LABELS[appointment.status] ?? appointment.status}
        </Badge>
      </div>
    </button>
  )
}

export { STATUS_LABELS }

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
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status] ?? 'bg-gray-100 text-gray-800'
  const displayName = appointment.patientName ?? appointment.bookingName ?? 'Sem paciente'
  const timeStr = `${appointment.startTime.slice(0, 5)} - ${appointment.endTime.slice(0, 5)}`

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onClick?.(appointment)}
        className={cn(
          'w-full rounded-md px-2 py-1 text-left text-xs transition-opacity hover:opacity-80',
          statusColor
        )}
      >
        <span className="font-medium">{appointment.startTime.slice(0, 5)}</span>{' '}
        <span className="truncate">{displayName}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(appointment)}
      className={cn(
        'w-full rounded-md border-l-4 bg-white px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md dark:bg-gray-900',
        appointment.status === 'scheduled' && 'border-l-blue-500',
        appointment.status === 'confirmed' && 'border-l-green-500',
        appointment.status === 'in_progress' && 'border-l-yellow-500',
        appointment.status === 'completed' && 'border-l-gray-400',
        appointment.status === 'cancelled' && 'border-l-red-500',
        appointment.status === 'no_show' && 'border-l-orange-500'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <p className="text-xs text-muted-foreground">{timeStr}</p>
          {appointment.procedureTypeName && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {appointment.procedureTypeName}
            </p>
          )}
        </div>
        <Badge className={cn('shrink-0', statusColor)}>
          {STATUS_LABELS[appointment.status] ?? appointment.status}
        </Badge>
      </div>
    </button>
  )
}

export { STATUS_LABELS }

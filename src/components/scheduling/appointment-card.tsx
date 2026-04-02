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

/**
 * Stable color palette for practitioners.
 * Uses a hash of the practitioner ID to assign a consistent color.
 */
const PRACTITIONER_COLORS = [
  'border-l-[#4A6B52]', // forest green
  'border-l-[#6B4A8A]', // purple
  'border-l-[#C2785C]', // terracotta
  'border-l-[#4A7B9D]', // steel blue
  'border-l-[#8A6B4A]', // warm brown
  'border-l-[#5C8A6B]', // teal green
  'border-l-[#9D4A6B]', // raspberry
  'border-l-[#6B8A4A]', // olive
]

function getPractitionerColor(practitionerId: string): string {
  let hash = 0
  for (let i = 0; i < practitionerId.length; i++) {
    hash = ((hash << 5) - hash + practitionerId.charCodeAt(i)) | 0
  }
  return PRACTITIONER_COLORS[Math.abs(hash) % PRACTITIONER_COLORS.length]
}

interface AppointmentCardProps {
  appointment: AppointmentWithDetails
  compact?: boolean
  showPractitioner?: boolean
  onClick?: (appointment: AppointmentWithDetails, event?: React.MouseEvent) => void
}

export function AppointmentCard({ appointment, compact = false, showPractitioner = false, onClick }: AppointmentCardProps) {
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status] ?? 'bg-[#F0F7F1] text-sage'
  const displayName = appointment.patientName ?? appointment.bookingName ?? 'Sem paciente'
  const timeStr = `${appointment.startTime.slice(0, 5)} - ${appointment.endTime.slice(0, 5)}`
  const practitionerBorder = getPractitionerColor(appointment.practitionerId)

  if (compact) {
    return (
      <button
        type="button"
        data-testid={`appointment-card-${appointment.id}`}
        onClick={(e) => onClick?.(appointment, e)}
        title={`${timeStr} · ${displayName} · ${appointment.practitionerName}`}
        className={cn(
          'w-full h-full rounded-[3px] border-l-[3px] px-1.5 py-0.5 text-left text-[10px] leading-tight transition-colors duration-150 overflow-hidden',
          statusColor,
          practitionerBorder
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
      data-testid={`appointment-card-${appointment.id}`}
      onClick={(e) => onClick?.(appointment, e)}
      className={cn(
        'w-full h-full rounded-[3px] border-l-[3px] bg-white px-3 py-1.5 text-left shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200 overflow-hidden',
        practitionerBorder
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[#2A2A2A]">{displayName}</p>
          <p className="text-[11px] text-[#7A7A7A]">{timeStr}</p>
          {showPractitioner && (
            <p className="truncate text-[11px] font-medium text-[#4A6B52]">
              {appointment.practitionerName}
            </p>
          )}
          {!showPractitioner && appointment.procedureTypeName && (
            <p className="mt-0.5 truncate text-[11px] text-[#7A7A7A]">
              {appointment.procedureTypeName}
            </p>
          )}
        </div>
        <Badge className={cn('shrink-0 rounded-full text-[10px] px-1.5 py-0', statusColor)}>
          {STATUS_LABELS[appointment.status] ?? appointment.status}
        </Badge>
      </div>
    </button>
  )
}

export { STATUS_LABELS }

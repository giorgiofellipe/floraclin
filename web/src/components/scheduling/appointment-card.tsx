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
  pending_reschedule: 'Aguardando Reagendamento',
}

const STATUS_BORDER_COLORS: Record<string, string> = {
  scheduled: 'border-l-blue-400',
  confirmed: 'border-l-emerald-400',
  in_progress: 'border-l-indigo-400',
  completed: 'border-l-slate-300',
  cancelled: 'border-l-red-400',
  no_show: 'border-l-rose-400',
  pending_reschedule: 'border-l-amber-400',
}

const PRACTITIONER_BG_COLORS = [
  'bg-[#4A6B52]/8',  // forest green
  'bg-[#6B4A8A]/8',  // purple
  'bg-[#C2785C]/8',  // terracotta
  'bg-[#4A7B9D]/8',  // steel blue
  'bg-[#8A6B4A]/8',  // warm brown
  'bg-[#5C8A6B]/8',  // teal green
  'bg-[#9D4A6B]/8',  // raspberry
  'bg-[#6B8A4A]/8',  // olive
]

function getPractitionerBg(practitionerId: string): string {
  let hash = 0
  for (let i = 0; i < practitionerId.length; i++) {
    hash = ((hash << 5) - hash + practitionerId.charCodeAt(i)) | 0
  }
  return PRACTITIONER_BG_COLORS[Math.abs(hash) % PRACTITIONER_BG_COLORS.length]
}

interface AppointmentCardProps {
  appointment: AppointmentWithDetails
  compact?: boolean
  onClick?: (appointment: AppointmentWithDetails, event?: React.MouseEvent) => void
}

export function AppointmentCard({ appointment, compact = false, onClick }: AppointmentCardProps) {
  const statusBadge = APPOINTMENT_STATUS_COLORS[appointment.status] ?? 'bg-slate-100 text-slate-600'
  const statusBorder = STATUS_BORDER_COLORS[appointment.status] ?? 'border-l-slate-300'
  const practitionerBg = getPractitionerBg(appointment.practitionerId)
  const displayName = appointment.patientName ?? appointment.bookingName ?? 'Sem paciente'
  const displayText = appointment.procedureTypeName
    ? `${displayName} · ${appointment.procedureTypeName}`
    : displayName
  const timeStr = `${appointment.startTime.slice(0, 5)} - ${appointment.endTime.slice(0, 5)}`

  if (compact) {
    return (
      <button
        type="button"
        data-testid={`appointment-card-${appointment.id}`}
        onClick={(e) => onClick?.(appointment, e)}
        title={`${timeStr} · ${displayText} · ${appointment.practitionerName} · ${STATUS_LABELS[appointment.status] ?? appointment.status}`}
        className={cn(
          'w-full h-full rounded-[3px] border-l-[3px] px-2 py-1 text-left text-xs leading-snug transition-colors duration-150 overflow-hidden',
          practitionerBg,
          statusBorder
        )}
      >
        <span className="font-semibold">{appointment.startTime.slice(0, 5)}</span>{' '}
        <span className="truncate">{displayText}</span>
        <span className="block truncate text-[11px] opacity-70">{appointment.practitionerName}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid={`appointment-card-${appointment.id}`}
      onClick={(e) => onClick?.(appointment, e)}
      className={cn(
        'w-full h-full rounded-[3px] border-l-[3px] px-3 py-1.5 text-left shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200 overflow-hidden',
        practitionerBg,
        statusBorder
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#2A2A2A]">{displayName}</p>
          <p className="text-xs text-[#7A7A7A]">{timeStr}</p>
          <p className="truncate text-xs font-medium text-[#4A6B52]">
            {appointment.practitionerName}
          </p>
          {appointment.procedureTypeName && (
            <p className="truncate text-xs text-[#7A7A7A]">
              {appointment.procedureTypeName}
            </p>
          )}
        </div>
        <Badge className={cn('shrink-0 rounded-full text-[11px] px-2 py-0.5', statusBadge)}>
          {STATUS_LABELS[appointment.status] ?? appointment.status}
        </Badge>
      </div>
    </button>
  )
}

const STATUS_DOT_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-400',
  confirmed: 'bg-emerald-400',
  in_progress: 'bg-indigo-400',
  completed: 'bg-slate-300',
  cancelled: 'bg-red-400',
  no_show: 'bg-rose-400',
  pending_reschedule: 'bg-amber-400',
}

const STATUS_SELECT_ITEMS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(STATUS_LABELS).map(([key, label]) => [
    key,
    <span key={key} className="flex items-center gap-2">
      <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT_COLORS[key] ?? 'bg-slate-300'}`} />
      {label}
    </span>,
  ])
)

export { STATUS_LABELS, STATUS_SELECT_ITEMS }

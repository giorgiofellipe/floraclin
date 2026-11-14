'use client'

import { cn } from '@/lib/utils'
import {
  APPOINTMENT_STATUS_BORDER,
  APPOINTMENT_STATUS_DOT,
  APPOINTMENT_STATUS_ICON,
  APPOINTMENT_STATUS_LABELS,
} from '@/lib/appointment-status'
import { SETTLED_STATUSES } from '@/lib/appointment-actions'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

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

export function appointmentDisplayName(appointment: Pick<AppointmentWithDetails, 'patientName' | 'bookingName'>): string {
  return appointment.patientName ?? appointment.bookingName ?? 'Sem paciente'
}

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const entry = APPOINTMENT_STATUS_ICON[status]
  if (!entry) return null
  const Icon = entry.icon
  return <Icon className={cn('size-3.5 shrink-0', entry.className, className)} aria-hidden />
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-charcoal', className)}
      data-testid="appointment-status-chip"
    >
      <StatusIcon status={status} className="size-3" />
      <span className="truncate">{APPOINTMENT_STATUS_LABELS[status] ?? status}</span>
    </span>
  )
}

interface AppointmentCardProps {
  appointment: AppointmentWithDetails
  compact?: boolean
  onClick?: (appointment: AppointmentWithDetails, event: React.MouseEvent<HTMLElement>) => void
}

export function AppointmentCard({ appointment, compact = false, onClick }: AppointmentCardProps) {
  const statusBorder = APPOINTMENT_STATUS_BORDER[appointment.status] ?? 'border-l-slate-300'
  const practitionerBg = getPractitionerBg(appointment.practitionerId)
  const displayName = appointmentDisplayName(appointment)
  const shortName = appointment.patientName || appointment.bookingName ? displayName.split(' ')[0] : displayName
  const statusLabel = APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status
  const start = appointment.startTime.slice(0, 5)
  const timeStr = `${start} - ${appointment.endTime.slice(0, 5)}`
  const settled = SETTLED_STATUSES.has(appointment.status)
  const ariaLabel = [timeStr, displayName, appointment.procedureTypeName, appointment.practitionerName, statusLabel]
    .filter(Boolean)
    .join(', ')

  if (compact) {
    return (
      <button
        type="button"
        data-testid={`appointment-card-${appointment.id}`}
        data-status={appointment.status}
        onClick={(e) => onClick?.(appointment, e)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          'flex h-full w-full flex-col justify-start overflow-hidden rounded-[3px] border-l-[3px] px-1.5 py-1 text-left text-xs leading-snug transition-colors duration-150',
          practitionerBg,
          statusBorder,
          settled && 'opacity-70'
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          <StatusIcon status={appointment.status} className="size-3" />
          <span className="font-semibold tabular-nums">{start}</span>
          <span className="truncate font-medium text-charcoal">{shortName}</span>
        </span>
        {appointment.procedureTypeName && (
          <span className="block truncate text-[11px] text-charcoal/75">{appointment.procedureTypeName}</span>
        )}
        <span className="block truncate text-[11px] opacity-60">{appointment.practitionerName}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid={`appointment-card-${appointment.id}`}
      data-status={appointment.status}
      onClick={(e) => onClick?.(appointment, e)}
      aria-label={ariaLabel}
      className={cn(
        '@container flex h-full w-full flex-col justify-start overflow-hidden rounded-[3px] border-l-[3px] px-2.5 py-1.5 text-left shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200',
        practitionerBg,
        statusBorder,
        settled && 'opacity-75'
      )}
    >
      <div className="flex w-full min-w-0 items-start justify-between gap-1.5">
        <p className="min-w-0 truncate text-sm font-medium text-charcoal">{displayName}</p>
        <StatusChip status={appointment.status} className="hidden shrink-0 @[14rem]:inline-flex" />
        <span className={cn('mt-1 size-2 shrink-0 rounded-full @[14rem]:hidden', APPOINTMENT_STATUS_DOT[appointment.status])} aria-hidden />
      </div>
      <p className="truncate text-xs text-mid tabular-nums">
        {timeStr}
        <span className="@[14rem]:hidden"> · {statusLabel}</span>
      </p>
      {appointment.procedureTypeName && <p className="truncate text-xs text-mid">{appointment.procedureTypeName}</p>}
      <p className="truncate text-xs font-medium text-sage">{appointment.practitionerName}</p>
    </button>
  )
}

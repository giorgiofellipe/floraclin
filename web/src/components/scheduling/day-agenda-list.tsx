'use client'

import * as React from 'react'
import Link from 'next/link'
import { BanIcon, PlusIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { StatusChip, appointmentDisplayName } from '@/components/scheduling/appointment-card'
import { SETTLED_STATUSES, atendimentoHref, patientHref, primaryAppointmentAction } from '@/lib/appointment-actions'
import { minutesOfDay, minutesToTime, type WorkingHours } from '@/lib/free-slots'
import { dayAgendaRows } from '@/lib/agenda-slots'
import { cn } from '@/lib/utils'
import { toLocalYmd } from '@/lib/dates'
import { toHhMm } from '@/lib/time-options'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import type { Role } from '@/types'

const SWIPE_MIN_PX = 60

function hourLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

interface DayAgendaListProps {
  date: string
  /** Whose free time the gap rows show; a gap row books this practitioner. */
  practitionerId: string
  appointments: AppointmentWithDetails[]
  blocks: CalendarBlockRow[]
  workingHours: WorkingHours | null | undefined
  role: Role
  canBook: boolean
  pendingIds: Set<string>
  emptyState?: React.ReactNode
  onBook: (time: string, anchor: HTMLElement) => void
  onOpen: (appointment: AppointmentWithDetails, event: React.MouseEvent<HTMLElement>) => void
  onBlockClick: (block: CalendarBlockRow, event: React.MouseEvent) => void
  onConfirm: (appointment: AppointmentWithDetails) => void
  onStart: (appointment: AppointmentWithDetails) => void
  onSwipe: (direction: 'prev' | 'next') => void
}

export function DayAgendaList({
  date,
  practitionerId,
  appointments,
  blocks,
  workingHours,
  role,
  canBook,
  pendingIds,
  emptyState,
  onBook,
  onOpen,
  onBlockClick,
  onConfirm,
  onStart,
  onSwipe,
}: DayAgendaListProps) {
  const touchStart = React.useRef<{ x: number; y: number } | null>(null)
  const now = new Date()
  const rows = dayAgendaRows({ date, practitionerId, appointments, blocks, workingHours, now: { ymd: toLocalYmd(now), minutes: minutesOfDay(now) } })
  const visibleRows = canBook ? rows : rows.filter((row) => row.kind !== 'gap')

  return (
    <div
      className="min-h-full px-3 pb-24 pt-2"
      data-testid="day-agenda-list"
      onTouchStart={(e) => {
        const t = e.touches[0]
        touchStart.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const t = e.changedTouches[0]
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 'next' : 'prev')
      }}
    >
      {appointments.length === 0 && emptyState}
      <ul className="divide-y divide-topbar-border">
        {visibleRows.map((row) => {
          if (row.kind === 'gap') {
            return (
              <li key={`gap-${row.at}`}>
                <ReadOnlyGuard label="Agendar">
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-2 rounded-md px-1 text-left text-[13px] font-medium text-sage transition-colors hover:bg-confirmed-bg active:bg-confirmed-bg"
                    onClick={(e) => onBook(minutesToTime(row.gap.start), e.currentTarget)}
                    data-testid="day-gap-row"
                  >
                    <PlusIcon className="size-4" />
                    Livre {hourLabel(row.gap.start)}-{hourLabel(row.gap.end)}
                  </button>
                </ReadOnlyGuard>
              </li>
            )
          }
          if (row.kind === 'block') {
            const { block } = row
            return (
              <li key={`block-${block.id}`}>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-1 text-left text-[13px] text-mid transition-colors hover:bg-content-bg"
                  onClick={(e) => onBlockClick(block, e)}
                  data-testid="day-block-row"
                >
                  <BanIcon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    Indisponível · {block.allDay || !block.startTime || !block.endTime ? 'dia inteiro' : `${toHhMm(block.startTime)}-${toHhMm(block.endTime)}`}
                  </span>
                  <span className="shrink-0 truncate text-[12px]">{block.practitionerName ?? 'Toda a clínica'}</span>
                </button>
              </li>
            )
          }
          return (
            <AgendaListRow
              key={row.appointment.id}
              appointment={row.appointment}
              role={role}
              pending={pendingIds.has(row.appointment.id)}
              onOpen={onOpen}
              onConfirm={onConfirm}
              onStart={onStart}
            />
          )
        })}
      </ul>
    </div>
  )
}

function AgendaListRow({
  appointment,
  role,
  pending,
  onOpen,
  onConfirm,
  onStart,
}: {
  appointment: AppointmentWithDetails
  role: Role
  pending: boolean
  onOpen: DayAgendaListProps['onOpen']
  onConfirm: DayAgendaListProps['onConfirm']
  onStart: DayAgendaListProps['onStart']
}) {
  const action = primaryAppointmentAction(appointment, role)
  const name = appointmentDisplayName(appointment)
  const settled = SETTLED_STATUSES.has(appointment.status)
  const label = action?.short ?? action?.label

  let control: React.ReactNode = null
  if (action?.kind === 'register') {
    control = (
      <Link href={patientHref(appointment)} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}>
        {label}
      </Link>
    )
  } else if (action?.kind === 'open') {
    control = (
      <Link href={atendimentoHref(appointment)} className={cn(buttonVariants(), 'h-11 px-4')}>
        {label}
      </Link>
    )
  } else if (action?.kind === 'status' || action?.kind === 'start') {
    control = (
      <Button
        className="h-11 px-4"
        disabled={pending}
        onClick={() => (action.kind === 'status' ? onConfirm(appointment) : onStart(appointment))}
      >
        {label}
      </Button>
    )
  }

  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="day-agenda-row" data-status={appointment.status}>
      <button
        type="button"
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md text-left"
        onClick={(e) => onOpen(appointment, e)}
        aria-label={`${appointment.startTime.slice(0, 5)}, ${name}: mais ações`}
      >
        <span className={cn('w-11 shrink-0 text-[13px] tabular-nums leading-tight', settled ? 'text-mid' : 'text-charcoal')}>
          <span className="block font-medium">{appointment.startTime.slice(0, 5)}</span>
          <span className="block text-[11px] text-mid">{appointment.endTime.slice(0, 5)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[14px] font-medium', settled ? 'text-mid' : 'text-charcoal')}>{name}</span>
          {appointment.procedureTypeName && (
            <span className="block truncate text-[12px] text-mid">{appointment.procedureTypeName}</span>
          )}
          <StatusChip status={appointment.status} className="mt-1 bg-content-bg" />
        </span>
      </button>
      {control && action && <ReadOnlyGuard label={action.label}>{control}</ReadOnlyGuard>}
    </li>
  )
}

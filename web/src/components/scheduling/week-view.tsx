'use client'

import * as React from 'react'
import { format, startOfWeek, addDays, isSameDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { AgendaDnd } from '@/components/scheduling/agenda-dnd'
import { WEEK_SLOT_HEIGHT } from '@/components/scheduling/grid'
import {
  TimeGridColumn,
  TimeLabels,
  type AppointmentClickHandler,
  type BlockClickHandler,
  type SlotClickHandler,
} from '@/components/scheduling/time-grid-column'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import type { Slot } from '@/hooks/mutations/use-move-appointment'
import { openingWindow, type WorkingHours } from '@/lib/free-slots'

const NO_APPOINTMENTS: AppointmentWithDetails[] = []

interface WeekViewProps {
  date: Date
  appointments: AppointmentWithDetails[]
  calendarBlocks?: CalendarBlockRow[]
  workingHours: WorkingHours | null | undefined
  canDrag: (appointment: AppointmentWithDetails) => boolean
  onMove: (appointment: AppointmentWithDetails, slot: Slot) => void
  onSlotClick?: SlotClickHandler
  onAppointmentClick?: AppointmentClickHandler
  onBlockClick?: BlockClickHandler
}

export function WeekView({ date, appointments, calendarBlocks = [], workingHours, canDrag, onMove, onSlotClick, onAppointmentClick, onBlockClick }: WeekViewProps) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const weekKey = format(weekStart, 'yyyy-MM-dd')
  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the week's first day, not the Date identity
    [weekKey],
  )
  const byDay = React.useMemo(() => {
    const groups = new Map<string, AppointmentWithDetails[]>()
    for (const a of appointments) groups.set(a.date, [...(groups.get(a.date) ?? []), a])
    return groups
  }, [appointments])
  const today = new Date()
  const firstColumn = React.useRef<HTMLDivElement>(null)

  const geometry = React.useMemo(
    () => ({
      slotHeight: WEEK_SLOT_HEIGHT,
      days: days.map((d) => format(d, 'yyyy-MM-dd')),
      columnWidth: () => firstColumn.current?.getBoundingClientRect().width ?? 0,
    }),
    [days],
  )

  return (
    // Below md the grid keeps a readable column width and the calendar container scrolls sideways.
    <div className="flex min-w-[720px] flex-col md:min-w-0">
      <div className="sticky top-0 z-40 flex border-b border-topbar-border bg-white">
        <div className="sticky left-0 z-10 w-12 flex-shrink-0 bg-white md:w-16" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn('min-w-0 flex-1 border-l border-sage/10 px-1 py-2.5 text-center', isSameDay(day, today) && 'bg-sage/5')}
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-mid">{format(day, 'EEE', { locale: ptBR })}</p>
            <p
              className={cn(
                'mt-0.5 text-sm font-medium text-charcoal',
                isSameDay(day, today) && 'inline-flex size-7 items-center justify-center rounded-full bg-sage font-semibold text-cream'
              )}
            >
              {format(day, 'd')}
            </p>
          </div>
        ))}
      </div>

      <AgendaDnd geometry={geometry} onMove={onMove}>
        <div className="relative flex flex-1">
          <TimeLabels slotHeight={WEEK_SLOT_HEIGHT} className="z-[35]" />
          {days.map((day, i) => {
            const dateStr = geometry.days[i]
            const isDayToday = isSameDay(day, today)
            return (
              <TimeGridColumn
                key={dateStr}
                columnRef={i === 0 ? firstColumn : undefined}
                date={dateStr}
                opening={openingWindow(dateStr, workingHours)}
                appointments={byDay.get(dateStr) ?? NO_APPOINTMENTS}
                blocks={calendarBlocks.filter((b) => b.date === dateStr)}
                slotHeight={WEEK_SLOT_HEIGHT}
                compact
                isToday={isDayToday}
                className={isDayToday ? 'bg-sage/[0.03]' : undefined}
                canDrag={canDrag}
                onSlotClick={onSlotClick}
                onAppointmentClick={onAppointmentClick}
                onBlockClick={onBlockClick}
              />
            )
          })}
        </div>
      </AgendaDnd>
    </div>
  )
}

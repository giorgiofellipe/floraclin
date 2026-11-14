'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AgendaDnd } from '@/components/scheduling/agenda-dnd'
import { DAY_SLOT_HEIGHT } from '@/components/scheduling/grid'
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
import { toLocalYmd } from '@/lib/dates'

interface DayViewProps {
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

export function DayView({ date, appointments, calendarBlocks = [], workingHours, canDrag, onMove, onSlotClick, onAppointmentClick, onBlockClick }: DayViewProps) {
  const dateStr = format(date, 'yyyy-MM-dd')
  const dayAppointments = React.useMemo(() => appointments.filter((a) => a.date === dateStr), [appointments, dateStr])
  const geometry = React.useMemo(() => ({ slotHeight: DAY_SLOT_HEIGHT, days: [dateStr], columnWidth: null }), [dateStr])

  return (
    <AgendaDnd geometry={geometry} onMove={onMove}>
      <div className="border-b border-topbar-border bg-white px-4 py-3 text-center">
        <h3 className="text-[14px] font-medium tracking-tight text-charcoal first-letter:uppercase">
          {format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </h3>
      </div>
      <div className="relative flex pt-2">
        <TimeLabels slotHeight={DAY_SLOT_HEIGHT} className="z-10" />
        <TimeGridColumn
          date={dateStr}
          opening={openingWindow(dateStr, workingHours)}
          appointments={dayAppointments}
          blocks={calendarBlocks.filter((b) => b.date === dateStr)}
          slotHeight={DAY_SLOT_HEIGHT}
          compact={false}
          isToday={toLocalYmd(new Date()) === dateStr}
          canDrag={canDrag}
          onSlotClick={onSlotClick}
          onAppointmentClick={onAppointmentClick}
          onBlockClick={onBlockClick}
        />
      </div>
    </AgendaDnd>
  )
}

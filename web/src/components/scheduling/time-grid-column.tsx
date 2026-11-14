'use client'

import * as React from 'react'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import { DraggableAppointment } from '@/components/scheduling/agenda-dnd'
import {
  computeOverlapLayout,
  GRID_END_MIN,
  GRID_HOURS,
  GRID_START_MIN,
  GRID_SLOT_MIN,
  minutesToTop,
} from '@/components/scheduling/grid'
import { blockInterval, minutesOfDay, type Interval } from '@/lib/free-slots'
import { cn } from '@/lib/utils'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'

export type SlotClickHandler = (date: string, time: string, anchor: HTMLElement) => void
export type AppointmentClickHandler = (appointment: AppointmentWithDetails, event: React.MouseEvent<HTMLElement>) => void
export type BlockClickHandler = (block: CalendarBlockRow, event: React.MouseEvent) => void

const HALF_HOURS = GRID_HOURS.flatMap((hour) => [`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`])

export function TimeLabels({ slotHeight, className }: { slotHeight: number; className?: string }) {
  return (
    <div className={cn('sticky left-0 w-12 flex-shrink-0 bg-white md:w-16', className)} aria-hidden>
      {GRID_HOURS.map((hour) => (
        <div key={hour} className="flex items-start" style={{ height: slotHeight * 2 }}>
          <span className="-mt-2 w-full select-none pr-2 text-right text-[11px] font-medium text-mid md:pr-3">
            {String(hour).padStart(2, '0')}:00
          </span>
        </div>
      ))}
    </div>
  )
}

interface TimeGridColumnProps {
  date: string
  appointments: AppointmentWithDetails[]
  blocks: CalendarBlockRow[]
  slotHeight: number
  compact: boolean
  isToday: boolean
  canDrag: (appointment: AppointmentWithDetails) => boolean
  onSlotClick?: SlotClickHandler
  onAppointmentClick?: AppointmentClickHandler
  onBlockClick?: BlockClickHandler
  /** The clinic's opening hours that day; the hours outside are tinted (still bookable). Null when closed. */
  opening: Interval | null
  className?: string
  columnRef?: React.Ref<HTMLDivElement>
}

export function TimeGridColumn({
  date,
  appointments,
  blocks,
  slotHeight,
  compact,
  isToday,
  canDrag,
  onSlotClick,
  onAppointmentClick,
  onBlockClick,
  opening,
  className,
  columnRef,
}: TimeGridColumnProps) {
  const layout = React.useMemo(() => computeOverlapLayout(appointments, slotHeight), [appointments, slotHeight])
  const now = new Date()
  const nowMinutes = minutesOfDay(now)
  const gap = compact ? 1 : 2
  const closedBands: Interval[] = opening
    ? [
        { start: GRID_START_MIN, end: Math.max(GRID_START_MIN, opening.start) },
        { start: Math.min(GRID_END_MIN, opening.end), end: GRID_END_MIN },
      ].filter((band) => band.end > band.start)
    : [{ start: GRID_START_MIN, end: GRID_END_MIN }]

  return (
    <div ref={columnRef} className={cn('relative min-w-0 flex-1 border-l border-sage/10', className)} data-testid={`grid-day-${date}`}>
      {HALF_HOURS.map((time) => {
        const onHour = time.endsWith(':00')
        const cell = cn(
          'block w-full',
          onHour ? 'border-b border-sage/8' : 'border-b border-dashed border-sage/5',
        )
        return onSlotClick ? (
          <button
            key={time}
            type="button"
            tabIndex={-1}
            aria-label={`Agendar às ${time}`}
            className={cn(cell, 'cursor-pointer transition-colors hover:bg-confirmed-bg/60')}
            style={{ height: slotHeight }}
            onClick={(e) => onSlotClick(date, time, e.currentTarget)}
          />
        ) : (
          <div key={time} className={cell} style={{ height: slotHeight }} />
        )
      })}

      {closedBands.map((band) => (
        <div
          key={band.start}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bg-content-bg/70"
          style={{ top: minutesToTop(band.start, slotHeight), height: ((band.end - band.start) / GRID_SLOT_MIN) * slotHeight }}
          data-testid="closed-hours"
        />
      ))}

      {isToday && nowMinutes >= GRID_START_MIN && nowMinutes <= GRID_END_MIN && (
        <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: minutesToTop(nowMinutes, slotHeight) }} data-testid="now-line">
          <div className="flex items-center">
            <div className="size-2 rounded-full bg-sage" />
            <div className="h-[2px] flex-1 bg-sage/60" />
          </div>
        </div>
      )}

      {blocks.map((block) => {
        let top = 0
        let height = HALF_HOURS.length * slotHeight
        if (!block.allDay) {
          if (!block.startTime || !block.endTime) return null
          const busy = blockInterval(block)
          const start = Math.max(busy.start, GRID_START_MIN)
          const end = Math.min(busy.end, GRID_END_MIN)
          if (start >= end) return null
          top = minutesToTop(start, slotHeight)
          height = Math.max(((end - start) / GRID_SLOT_MIN) * slotHeight, slotHeight / 2)
        }
        return (
          <button
            key={block.id}
            type="button"
            className={cn(
              'absolute inset-x-0 z-10 cursor-pointer overflow-hidden rounded border border-dashed border-gray-300 bg-gray-100/60 text-left transition-colors hover:bg-gray-200/60',
              compact ? 'mx-0.5 px-1 py-0.5' : 'mx-1 px-2 py-1',
            )}
            style={{ top, height }}
            onClick={(e) => onBlockClick?.(block, e)}
          >
            <span className={cn('block truncate font-medium text-gray-500', compact ? 'text-[10px]' : 'text-[11px]')}>Indisponível</span>
            <span className={cn('block truncate text-gray-400', compact ? 'text-[9px]' : 'text-[10px]')}>
              {block.practitionerName ?? 'Toda a clínica'}
            </span>
          </button>
        )
      })}

      {layout.map(({ appointment, top, height, column, totalColumns }) => {
        const width = 100 / totalColumns
        const left = (100 * column) / totalColumns
        return (
          <DraggableAppointment
            key={appointment.id}
            appointment={appointment}
            disabled={!canDrag(appointment)}
            className="absolute z-20 overflow-visible"
            style={{ top, height, left: `calc(${left}% + ${gap}px)`, width: `calc(${width}% - ${gap * 2}px)` }}
          >
            <AppointmentCard appointment={appointment} compact={compact} onClick={onAppointmentClick} />
          </DraggableAppointment>
        )
      })}
    </div>
  )
}

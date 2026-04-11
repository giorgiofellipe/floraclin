'use client'

import * as React from 'react'
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import { AppointmentCard } from './appointment-card'

const START_HOUR = 7
const END_HOUR = 20
const SLOT_HEIGHT_PX = 40
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

interface WeekViewProps {
  date: Date
  appointments: AppointmentWithDetails[]
  onSlotClick?: (date: string, time: string) => void
  onAppointmentClick?: (appointment: AppointmentWithDetails, event?: React.MouseEvent) => void
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

interface LayoutSlot {
  appointment: AppointmentWithDetails
  top: number
  height: number
  column: number
  totalColumns: number
}

function computeOverlapLayout(appointments: AppointmentWithDetails[]): LayoutSlot[] {
  if (appointments.length === 0) return []

  const sorted = [...appointments].sort((a, b) => {
    const aStart = timeToMinutes(a.startTime)
    const bStart = timeToMinutes(b.startTime)
    if (aStart !== bStart) return aStart - bStart
    return timeToMinutes(b.endTime) - timeToMinutes(a.endTime)
  })

  const clusters: AppointmentWithDetails[][] = []
  let currentCluster: AppointmentWithDetails[] = []
  let clusterEnd = 0

  for (const appt of sorted) {
    const start = timeToMinutes(appt.startTime)
    const end = timeToMinutes(appt.endTime)

    if (currentCluster.length === 0 || start < clusterEnd) {
      currentCluster.push(appt)
      clusterEnd = Math.max(clusterEnd, end)
    } else {
      clusters.push(currentCluster)
      currentCluster = [appt]
      clusterEnd = end
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster)

  const result: LayoutSlot[] = []

  for (const cluster of clusters) {
    const columns: number[][] = []

    for (const appt of cluster) {
      const startMin = timeToMinutes(appt.startTime)
      const endMin = timeToMinutes(appt.endTime)
      const gridStartMin = START_HOUR * 60

      const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT_PX
      const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2)

      let col = 0
      while (col < columns.length) {
        const lastEnd = columns[col][columns[col].length - 1]
        if (startMin >= lastEnd) break
        col++
      }
      if (col >= columns.length) columns.push([])
      columns[col].push(endMin)

      result.push({ appointment: appt, top, height, column: col, totalColumns: 0 })
    }

    const totalCols = columns.length
    for (const slot of result) {
      if (cluster.includes(slot.appointment)) {
        slot.totalColumns = totalCols
      }
    }
  }

  return result
}

export function WeekView({ date, appointments, onSlotClick, onAppointmentClick }: WeekViewProps) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }) // Monday
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  // Current time indicator
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentTimeTop = ((currentMinutes - START_HOUR * 60) / 30) * SLOT_HEIGHT_PX

  return (
    <div className="flex flex-col overflow-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-20 flex border-b border-[#E8ECEF] bg-white">
        <div className="w-16 flex-shrink-0" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn(
              'flex-1 border-l border-sage/10 px-1 py-2.5 text-center',
              isSameDay(day, today) && 'bg-sage/5'
            )}
          >
            <p className="text-[11px] uppercase tracking-wider text-mid font-medium">
              {format(day, 'EEE', { locale: ptBR })}
            </p>
            <p
              className={cn(
                'mt-0.5 text-sm font-medium text-charcoal',
                isSameDay(day, today) &&
                  'inline-flex size-7 items-center justify-center rounded-full bg-sage text-cream font-semibold'
              )}
            >
              {format(day, 'd')}
            </p>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="relative flex flex-1">
        {/* Time labels */}
        <div className="sticky left-0 z-10 w-16 flex-shrink-0 bg-white">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start"
              style={{ height: SLOT_HEIGHT_PX * 2 }}
            >
              <span className="w-full pr-3 text-right text-[11px] font-medium text-mid -mt-2 select-none">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Columns */}
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointments.filter((a) => a.date === dateStr)
          const isDayToday = isSameDay(day, today)
          const layoutSlots = computeOverlapLayout(dayAppointments)

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative flex-1 border-l border-sage/10',
                isDayToday && 'bg-sage/[0.03]'
              )}
            >
              {/* Grid slots */}
              {HOURS.map((hour) => (
                <React.Fragment key={hour}>
                  <div
                    className="cursor-pointer border-b border-sage/8 transition-colors hover:bg-[#F0F7F1]/30"
                    style={{ height: SLOT_HEIGHT_PX }}
                    onClick={() =>
                      onSlotClick?.(dateStr, `${String(hour).padStart(2, '0')}:00`)
                    }
                  />
                  <div
                    className="cursor-pointer border-b border-dashed border-sage/5 transition-colors hover:bg-[#F0F7F1]/30"
                    style={{ height: SLOT_HEIGHT_PX }}
                    onClick={() =>
                      onSlotClick?.(dateStr, `${String(hour).padStart(2, '0')}:30`)
                    }
                  />
                </React.Fragment>
              ))}

              {/* Current time indicator */}
              {isDayToday && currentMinutes >= START_HOUR * 60 && currentMinutes <= END_HOUR * 60 && (
                <div
                  className="absolute left-0 right-0 z-30 pointer-events-none"
                  style={{ top: currentTimeTop }}
                >
                  <div className="flex items-center">
                    <div className="size-2 rounded-full bg-sage" />
                    <div className="h-[2px] flex-1 bg-sage/60" />
                  </div>
                </div>
              )}

              {/* Appointments — split horizontally when overlapping */}
              {layoutSlots.map(({ appointment: appt, top, height, column, totalColumns }) => {
                const widthPercent = 100 / totalColumns
                const leftPercent = column * widthPercent
                return (
                  <div
                    key={appt.id}
                    className="absolute z-20"
                    style={{
                      top,
                      height,
                      left: `calc(${leftPercent}% + 1px)`,
                      width: `calc(${widthPercent}% - 2px)`,
                    }}
                  >
                    <AppointmentCard
                      appointment={appt}
                      compact
                      onClick={onAppointmentClick}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

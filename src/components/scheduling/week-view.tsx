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
import { APPOINTMENT_STATUS_COLORS } from '@/lib/constants'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const START_HOUR = 7
const END_HOUR = 20
const SLOT_HEIGHT_PX = 40
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

interface WeekViewProps {
  date: Date
  appointments: AppointmentWithDetails[]
  onSlotClick?: (date: string, time: string) => void
  onAppointmentClick?: (appointment: AppointmentWithDetails) => void
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function WeekView({ date, appointments, onSlotClick, onAppointmentClick }: WeekViewProps) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }) // Monday
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  return (
    <div className="flex flex-col overflow-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-20 flex bg-background border-b border-border">
        <div className="w-16 flex-shrink-0" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn(
              'flex-1 border-l border-border px-1 py-2 text-center',
              isSameDay(day, today) && 'bg-primary/5'
            )}
          >
            <p className="text-xs uppercase text-muted-foreground">
              {format(day, 'EEE', { locale: ptBR })}
            </p>
            <p
              className={cn(
                'text-sm font-medium',
                isSameDay(day, today) &&
                  'inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground'
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
        <div className="sticky left-0 z-10 w-16 flex-shrink-0 bg-background">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start border-b border-dashed border-border"
              style={{ height: SLOT_HEIGHT_PX * 2 }}
            >
              <span className="w-full pr-2 text-right text-xs text-muted-foreground -mt-2">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Columns */}
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointments.filter((a) => a.date === dateStr)

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative flex-1 border-l border-border',
                isSameDay(day, today) && 'bg-primary/5'
              )}
            >
              {/* Grid slots */}
              {HOURS.map((hour) => (
                <React.Fragment key={hour}>
                  <div
                    className="cursor-pointer border-b border-border hover:bg-muted/50"
                    style={{ height: SLOT_HEIGHT_PX }}
                    onClick={() =>
                      onSlotClick?.(dateStr, `${String(hour).padStart(2, '0')}:00`)
                    }
                  />
                  <div
                    className="cursor-pointer border-b border-dashed border-border hover:bg-muted/50"
                    style={{ height: SLOT_HEIGHT_PX }}
                    onClick={() =>
                      onSlotClick?.(dateStr, `${String(hour).padStart(2, '0')}:30`)
                    }
                  />
                </React.Fragment>
              ))}

              {/* Appointments */}
              {dayAppointments.map((appt) => {
                const startMin = timeToMinutes(appt.startTime)
                const endMin = timeToMinutes(appt.endTime)
                const gridStartMin = START_HOUR * 60
                const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT_PX
                const height = Math.max(
                  ((endMin - startMin) / 30) * SLOT_HEIGHT_PX,
                  SLOT_HEIGHT_PX / 2
                )
                const statusColor =
                  APPOINTMENT_STATUS_COLORS[appt.status] ?? 'bg-gray-100 text-gray-800'
                const displayName = appt.patientName ?? appt.bookingName ?? 'Sem paciente'

                return (
                  <button
                    key={appt.id}
                    type="button"
                    className={cn(
                      'absolute inset-x-0.5 z-20 overflow-hidden rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-opacity hover:opacity-80',
                      statusColor
                    )}
                    style={{ top, height }}
                    onClick={() => onAppointmentClick?.(appt)}
                    title={`${appt.startTime.slice(0, 5)} - ${displayName}`}
                  >
                    <span className="font-medium">{appt.startTime.slice(0, 5)}</span>
                    <br />
                    <span className="truncate">{displayName}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

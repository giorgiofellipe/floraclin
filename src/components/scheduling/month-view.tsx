'use client'

import * as React from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  isToday,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { APPOINTMENT_STATUS_COLORS } from '@/lib/constants'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

interface MonthViewProps {
  date: Date
  appointments: AppointmentWithDetails[]
  onDayClick?: (date: string) => void
  onAppointmentClick?: (appointment: AppointmentWithDetails) => void
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MAX_VISIBLE_APPOINTMENTS = 3

export function MonthView({ date, appointments, onDayClick, onAppointmentClick }: MonthViewProps) {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  // Build grid of weeks
  const weeks: Date[][] = []
  let current = calendarStart
  while (current <= calendarEnd) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(current)
      current = addDays(current, 1)
    }
    weeks.push(week)
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-2 text-center">
        <h3 className="text-lg font-semibold capitalize">
          {format(date, "MMMM 'de' yyyy", { locale: ptBR })}
        </h3>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1 text-center text-xs font-medium text-muted-foreground">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid flex-1 grid-cols-7">
        {weeks.flat().map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const dayAppointments = appointments.filter((a) => a.date === dateStr)
          const isCurrentMonth = isSameMonth(day, date)
          const todayFlag = isToday(day)

          return (
            <div
              key={dateStr}
              className={cn(
                'min-h-24 cursor-pointer border-b border-r border-border p-1 transition-colors hover:bg-muted/50',
                !isCurrentMonth && 'bg-muted/30 text-muted-foreground'
              )}
              onClick={() => onDayClick?.(dateStr)}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs',
                    todayFlag && 'bg-primary text-primary-foreground font-medium'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {dayAppointments.length > MAX_VISIBLE_APPOINTMENTS && (
                  <span className="text-xs text-muted-foreground">
                    +{dayAppointments.length - MAX_VISIBLE_APPOINTMENTS}
                  </span>
                )}
              </div>

              <div className="mt-1 space-y-0.5">
                {dayAppointments.slice(0, MAX_VISIBLE_APPOINTMENTS).map((appt) => {
                  const statusColor =
                    APPOINTMENT_STATUS_COLORS[appt.status] ?? 'bg-petal text-mid'
                  const displayName = appt.patientName ?? appt.bookingName ?? 'Sem paciente'

                  return (
                    <button
                      key={appt.id}
                      type="button"
                      className={cn(
                        'w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-opacity hover:opacity-80',
                        statusColor
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        onAppointmentClick?.(appt)
                      }}
                    >
                      <span className="font-medium">{appt.startTime.slice(0, 5)}</span>{' '}
                      {displayName}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

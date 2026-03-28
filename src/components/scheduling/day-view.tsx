'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const START_HOUR = 7
const END_HOUR = 20
const SLOT_HEIGHT_PX = 48 // height of each 30-min slot
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

interface DayViewProps {
  date: Date
  appointments: AppointmentWithDetails[]
  onSlotClick?: (date: string, time: string) => void
  onAppointmentClick?: (appointment: AppointmentWithDetails) => void
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function getAppointmentPosition(appointment: AppointmentWithDetails) {
  const startMin = timeToMinutes(appointment.startTime)
  const endMin = timeToMinutes(appointment.endTime)
  const gridStartMin = START_HOUR * 60

  const top = ((startMin - gridStartMin) / 30) * SLOT_HEIGHT_PX
  const height = Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2)

  return { top, height }
}

export function DayView({ date, appointments, onSlotClick, onAppointmentClick }: DayViewProps) {
  const dateStr = format(date, 'yyyy-MM-dd')
  const dayAppointments = appointments.filter((a) => a.date === dateStr)

  return (
    <div className="flex flex-col">
      <div className="mb-2 text-center">
        <h3 className="text-lg font-semibold capitalize">
          {format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </h3>
      </div>

      <div className="relative flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="sticky left-0 z-10 w-16 flex-shrink-0 bg-background">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start border-b border-dashed border-border"
              style={{ height: SLOT_HEIGHT_PX * 2 }}
            >
              <span className="pr-2 text-right text-xs text-muted-foreground w-full -mt-2">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Grid + appointments */}
        <div className="relative flex-1 border-l border-border">
          {/* Grid lines */}
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
            const { top, height } = getAppointmentPosition(appt)
            return (
              <div
                key={appt.id}
                className="absolute left-1 right-1 z-20"
                style={{ top, height }}
              >
                <AppointmentCard
                  appointment={appt}
                  onClick={onAppointmentClick}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

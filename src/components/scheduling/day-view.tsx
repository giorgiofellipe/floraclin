'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
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

  // Current time indicator
  const now = new Date()
  const isToday = format(now, 'yyyy-MM-dd') === dateStr
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentTimeTop = ((currentMinutes - START_HOUR * 60) / 30) * SLOT_HEIGHT_PX

  return (
    <div className="flex flex-col">
      <div className="border-b border-gray-100 bg-white px-4 py-3 text-center">
        <h3 className="text-[14px] font-medium capitalize text-[#2A2A2A] tracking-tight">
          {format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </h3>
      </div>

      <div className="relative flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="sticky left-0 z-10 w-16 flex-shrink-0 bg-white">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start"
              style={{ height: SLOT_HEIGHT_PX * 2 }}
            >
              <span className="pr-3 text-right text-[11px] font-medium text-mid w-full -mt-2 select-none">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Grid + appointments */}
        <div className="relative flex-1 border-l border-sage/10">
          {/* Grid lines */}
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
          {isToday && currentMinutes >= START_HOUR * 60 && currentMinutes <= END_HOUR * 60 && (
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

          {/* Appointments */}
          {dayAppointments.map((appt) => {
            const { top, height } = getAppointmentPosition(appt)
            return (
              <div
                key={appt.id}
                className="absolute left-1 right-2 z-20"
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

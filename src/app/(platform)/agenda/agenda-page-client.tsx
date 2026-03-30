'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { useAppointments, usePractitioners, useAppointmentProcedureTypes } from '@/hooks/queries/use-appointments'
import { CalendarView } from '@/components/scheduling/calendar-view'
import AgendaLoading from './loading'

type ViewType = 'day' | 'week' | 'month'

function getDateRange(date: Date, view: ViewType) {
  switch (view) {
    case 'day':
      return {
        dateFrom: format(date, 'yyyy-MM-dd'),
        dateTo: format(date, 'yyyy-MM-dd'),
      }
    case 'week': {
      const ws = startOfWeek(date, { weekStartsOn: 1 })
      const we = endOfWeek(date, { weekStartsOn: 1 })
      return {
        dateFrom: format(ws, 'yyyy-MM-dd'),
        dateTo: format(we, 'yyyy-MM-dd'),
      }
    }
    case 'month': {
      const ms = startOfMonth(date)
      const me = endOfMonth(date)
      const calStart = startOfWeek(ms, { weekStartsOn: 1 })
      const calEnd = endOfWeek(me, { weekStartsOn: 1 })
      return {
        dateFrom: format(calStart, 'yyyy-MM-dd'),
        dateTo: format(calEnd, 'yyyy-MM-dd'),
      }
    }
  }
}

export function AgendaPageClient() {
  const searchParams = useSearchParams()

  const view = (['day', 'week', 'month'].includes(searchParams.get('view') ?? '')
    ? searchParams.get('view')
    : 'week') as ViewType

  const dateStr = searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')
  const currentDate = new Date(dateStr + 'T12:00:00')
  const practitionerFilter = searchParams.get('practitioner') ?? undefined

  const { dateFrom, dateTo } = useMemo(
    () => getDateRange(currentDate, view),
    [dateStr, view]
  )

  const { data: appointments, isLoading: appointmentsLoading } = useAppointments(
    practitionerFilter,
    dateFrom,
    dateTo
  )
  const { data: practitioners, isLoading: practitionersLoading } = usePractitioners()
  const { data: procTypes, isLoading: procTypesLoading } = useAppointmentProcedureTypes()

  if (appointmentsLoading || practitionersLoading || procTypesLoading) {
    return <AgendaLoading />
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#2A2A2A] tracking-tight">Agenda</h1>
        <p className="text-sm text-mid mt-0.5">
          Gerencie os agendamentos da clinica
        </p>
      </div>

      <CalendarView
        initialDate={dateStr}
        initialView={view}
        initialPractitionerId={practitionerFilter}
        practitioners={practitioners ?? []}
        procedureTypes={procTypes ?? []}
        initialAppointments={appointments ?? []}
      />
    </div>
  )
}

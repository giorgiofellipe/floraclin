'use client'

import * as React from 'react'
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DayView } from '@/components/scheduling/day-view'
import { WeekView } from '@/components/scheduling/week-view'
import { MonthView } from '@/components/scheduling/month-view'
import { AppointmentForm } from '@/components/scheduling/appointment-form'
import { listAppointmentsAction } from '@/actions/appointments'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

type ViewType = 'day' | 'week' | 'month'

interface Practitioner {
  id: string
  fullName: string
}

interface ProcedureType {
  id: string
  name: string
  estimatedDurationMin: number | null
}

interface CalendarViewProps {
  initialDate: string
  initialView: ViewType
  initialPractitionerId?: string
  practitioners: Practitioner[]
  procedureTypes: ProcedureType[]
  initialAppointments: AppointmentWithDetails[]
}

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
      // Extend to full weeks for the calendar grid
      const calStart = startOfWeek(ms, { weekStartsOn: 1 })
      const calEnd = endOfWeek(me, { weekStartsOn: 1 })
      return {
        dateFrom: format(calStart, 'yyyy-MM-dd'),
        dateTo: format(calEnd, 'yyyy-MM-dd'),
      }
    }
  }
}

export function CalendarView({
  initialDate,
  initialView,
  initialPractitionerId,
  practitioners,
  procedureTypes,
  initialAppointments,
}: CalendarViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [currentDate, setCurrentDate] = React.useState(new Date(initialDate + 'T12:00:00'))
  const [view, setView] = React.useState<ViewType>(initialView)
  const [practitionerId, setPractitionerId] = React.useState(initialPractitionerId ?? 'all')
  const [appointments, setAppointments] = React.useState(initialAppointments)
  const [isLoading, setIsLoading] = React.useState(false)

  // Form dialog state
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingAppointment, setEditingAppointment] = React.useState<AppointmentWithDetails | null>(null)
  const [defaultFormDate, setDefaultFormDate] = React.useState<string>('')
  const [defaultFormTime, setDefaultFormTime] = React.useState<string>('')

  // Update URL params
  const updateUrl = React.useCallback(
    (d: Date, v: ViewType, p: string) => {
      const params = new URLSearchParams()
      params.set('date', format(d, 'yyyy-MM-dd'))
      params.set('view', v)
      if (p && p !== 'all') params.set('practitioner', p)
      router.replace(`/agenda?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  // Fetch appointments when date/view/practitioner changes
  const fetchAppointments = React.useCallback(
    async (d: Date, v: ViewType, p: string) => {
      setIsLoading(true)
      try {
        const { dateFrom, dateTo } = getDateRange(d, v)
        const data = await listAppointmentsAction(
          p !== 'all' ? p : undefined,
          dateFrom,
          dateTo
        )
        setAppointments(data)
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  const navigate = (direction: 'prev' | 'next') => {
    let newDate: Date
    switch (view) {
      case 'day':
        newDate = direction === 'next' ? addDays(currentDate, 1) : subDays(currentDate, 1)
        break
      case 'week':
        newDate = direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1)
        break
      case 'month':
        newDate = direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1)
        break
    }
    setCurrentDate(newDate)
    updateUrl(newDate, view, practitionerId)
    fetchAppointments(newDate, view, practitionerId)
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    updateUrl(today, view, practitionerId)
    fetchAppointments(today, view, practitionerId)
  }

  const changeView = (newView: ViewType) => {
    setView(newView)
    updateUrl(currentDate, newView, practitionerId)
    fetchAppointments(currentDate, newView, practitionerId)
  }

  const changePractitioner = (newPractitionerId: string) => {
    setPractitionerId(newPractitionerId)
    updateUrl(currentDate, view, newPractitionerId)
    fetchAppointments(currentDate, view, newPractitionerId)
  }

  const handleSlotClick = (date: string, time: string) => {
    setEditingAppointment(null)
    setDefaultFormDate(date)
    setDefaultFormTime(time)
    setFormOpen(true)
  }

  const handleAppointmentClick = (appointment: AppointmentWithDetails) => {
    setEditingAppointment(appointment)
    setDefaultFormDate('')
    setDefaultFormTime('')
    setFormOpen(true)
  }

  const handleDayClick = (dateStr: string) => {
    const newDate = new Date(dateStr + 'T12:00:00')
    setCurrentDate(newDate)
    setView('day')
    updateUrl(newDate, 'day', practitionerId)
    fetchAppointments(newDate, 'day', practitionerId)
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open)
    if (!open) {
      setEditingAppointment(null)
      // Refresh appointments after form closes
      fetchAppointments(currentDate, view, practitionerId)
    }
  }

  const handleNewAppointment = () => {
    setEditingAppointment(null)
    setDefaultFormDate(format(currentDate, 'yyyy-MM-dd'))
    setDefaultFormTime('08:00')
    setFormOpen(true)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={() => navigate('prev')}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => navigate('next')}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h2 className="text-base font-medium capitalize">
            {view === 'day' && format(currentDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            {view === 'week' &&
              `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "d 'de' MMM", { locale: ptBR })} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "d 'de' MMM", { locale: ptBR })}`}
            {view === 'month' && format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Practitioner filter */}
          <Select value={practitionerId} onValueChange={(v) => v && changePractitioner(v)}>
            <SelectTrigger className="w-auto min-w-[140px]">
              <SelectValue placeholder="Profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {practitioners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex rounded-lg border border-border">
            {([
              ['day', 'Dia'],
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const).map(([v, label]) => (
              <Button
                key={v}
                variant={view === v ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none first:rounded-l-lg last:rounded-r-lg"
                onClick={() => changeView(v)}
              >
                {label}
              </Button>
            ))}
          </div>

          <Button size="sm" onClick={handleNewAppointment}>
            <Plus className="size-4" />
            Agendar
          </Button>
        </div>
      </div>

      {/* Calendar content */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/50">
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </div>
        )}

        {!isLoading && appointments.length === 0 && (
          <div className="absolute inset-x-0 top-4 z-20 flex justify-center pointer-events-none">
            <p className="rounded-md bg-petal px-4 py-2 text-sm text-mid">
              Nenhum agendamento para este período.
            </p>
          </div>
        )}

        {view === 'day' && (
          <DayView
            date={currentDate}
            appointments={appointments}
            onSlotClick={handleSlotClick}
            onAppointmentClick={handleAppointmentClick}
          />
        )}

        {view === 'week' && (
          <WeekView
            date={currentDate}
            appointments={appointments}
            onSlotClick={handleSlotClick}
            onAppointmentClick={handleAppointmentClick}
          />
        )}

        {view === 'month' && (
          <MonthView
            date={currentDate}
            appointments={appointments}
            onDayClick={handleDayClick}
            onAppointmentClick={handleAppointmentClick}
          />
        )}
      </div>

      {/* Appointment form dialog */}
      <AppointmentForm
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        appointment={editingAppointment}
        practitioners={practitioners}
        procedureTypes={procedureTypes}
        defaultDate={defaultFormDate}
        defaultStartTime={defaultFormTime}
        defaultPractitionerId={practitionerId !== 'all' ? practitionerId : undefined}
      />
    </div>
  )
}

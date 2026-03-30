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
import { useRouter } from 'next/navigation'
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
import { useAppointments } from '@/hooks/queries/use-appointments'
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

  const [currentDate, setCurrentDate] = React.useState(new Date(initialDate + 'T12:00:00'))
  const [view, setView] = React.useState<ViewType>(initialView)
  const [practitionerId, setPractitionerId] = React.useState(initialPractitionerId ?? 'all')

  // Form dialog state
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingAppointment, setEditingAppointment] = React.useState<AppointmentWithDetails | null>(null)
  const [defaultFormDate, setDefaultFormDate] = React.useState<string>('')
  const [defaultFormTime, setDefaultFormTime] = React.useState<string>('')

  // Derive date range from current state
  const { dateFrom, dateTo } = getDateRange(currentDate, view)
  const queryPractitionerId = practitionerId !== 'all' ? practitionerId : undefined

  // Use React Query for appointments data
  const { data: appointments = initialAppointments, isLoading } = useAppointments(
    queryPractitionerId,
    dateFrom,
    dateTo
  )

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
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    updateUrl(today, view, practitionerId)
  }

  const changeView = (newView: ViewType) => {
    setView(newView)
    updateUrl(currentDate, newView, practitionerId)
  }

  const changePractitioner = (newPractitionerId: string) => {
    setPractitionerId(newPractitionerId)
    updateUrl(currentDate, view, newPractitionerId)
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
  }

  const handleFormOpenChange = React.useCallback((open: boolean) => {
    setFormOpen(open)
    if (!open) {
      setEditingAppointment(null)
    }
  }, [])

  // After mutations, React Query invalidation handles refetch automatically
  const handleFormSaved = React.useCallback(() => {
    // No-op: mutation hooks' onSuccess invalidates appointments query automatically
  }, [])

  const handleNewAppointment = () => {
    setEditingAppointment(null)
    setDefaultFormDate(format(currentDate, 'yyyy-MM-dd'))
    setDefaultFormTime('08:00')
    setFormOpen(true)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={goToToday}>
            Hoje
          </Button>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" className="rounded-full text-mid hover:bg-petal hover:text-forest transition-colors" onClick={() => navigate('prev')} data-testid="calendar-date-prev">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" className="rounded-full text-mid hover:bg-petal hover:text-forest transition-colors" onClick={() => navigate('next')} data-testid="calendar-date-next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold capitalize text-[#2A2A2A] tracking-tight">
            {view === 'day' && format(currentDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            {view === 'week' &&
              `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "d 'de' MMM", { locale: ptBR })} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "d 'de' MMM", { locale: ptBR })}`}
            {view === 'month' && format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {/* Practitioner filter */}
          <Select value={practitionerId} onValueChange={(v) => v && changePractitioner(v)}>
            <SelectTrigger className="w-auto min-w-[140px] border-sage/20">
              <SelectValue placeholder="Profissional">
                {(value: string) => {
                  if (value === 'all') return 'Todos'
                  return practitioners.find((p) => p.id === value)?.fullName ?? value
                }}
              </SelectValue>
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

          {/* View toggle - pill style */}
          <div className="flex rounded-full bg-[#E8ECEF] p-0.5" data-testid="calendar-view-toggle">
            {([
              ['day', 'Dia'],
              ['week', 'Semana'],
              ['month', 'Mes'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                  view === v
                    ? 'bg-white text-forest shadow-sm'
                    : 'text-mid hover:text-forest'
                }`}
                onClick={() => changeView(v)}
              >
                {label}
              </button>
            ))}
          </div>

          <Button size="sm" className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleNewAppointment} data-testid="calendar-new-appointment">
            <Plus className="size-4" />
            Agendar
          </Button>
        </div>
      </div>

      {/* Calendar content */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 shadow-sm">
              <div className="size-2 animate-pulse rounded-full bg-sage" />
              <p className="text-sm font-medium text-forest">Carregando...</p>
            </div>
          </div>
        )}

        {!isLoading && appointments.length === 0 && (
          <div className="absolute inset-x-0 top-6 z-20 flex justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-full bg-white/80 px-5 py-2.5 shadow-sm backdrop-blur-sm">
              <span className="text-sm text-mid">Nenhum agendamento para este periodo.</span>
            </div>
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
        onSaved={handleFormSaved}
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

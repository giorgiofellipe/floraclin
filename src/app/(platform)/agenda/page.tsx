import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { getAuthContext } from '@/lib/auth'
import { listAppointments } from '@/db/queries/appointments'
import { listPractitioners } from '@/db/queries/appointments'
import { CalendarView } from '@/components/scheduling/calendar-view'
import { db } from '@/db/client'
import { procedureTypes } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

interface AgendaPageProps {
  searchParams: Promise<{
    view?: string
    date?: string
    practitioner?: string
  }>
}

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

export default async function AgendaPage({ searchParams }: AgendaPageProps) {
  const context = await getAuthContext()
  const params = await searchParams

  const view = (['day', 'week', 'month'].includes(params.view ?? '')
    ? params.view
    : 'week') as ViewType

  const dateStr = params.date ?? format(new Date(), 'yyyy-MM-dd')
  const currentDate = new Date(dateStr + 'T12:00:00')

  const practitionerFilter = params.practitioner

  // Fetch data in parallel
  const { dateFrom, dateTo } = getDateRange(currentDate, view)

  const [appointments, practitioners, procTypes] = await Promise.all([
    listAppointments(context.tenantId, {
      practitionerId: practitionerFilter,
      dateFrom,
      dateTo,
    }),
    listPractitioners(context.tenantId),
    db
      .select({
        id: procedureTypes.id,
        name: procedureTypes.name,
        estimatedDurationMin: procedureTypes.estimatedDurationMin,
      })
      .from(procedureTypes)
      .where(
        and(
          eq(procedureTypes.tenantId, context.tenantId),
          eq(procedureTypes.isActive, true),
          isNull(procedureTypes.deletedAt)
        )
      )
      .orderBy(procedureTypes.name),
  ])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os agendamentos da clínica
        </p>
      </div>

      <CalendarView
        initialDate={dateStr}
        initialView={view}
        initialPractitionerId={practitionerFilter}
        practitioners={practitioners}
        procedureTypes={procTypes}
        initialAppointments={appointments}
      />
    </div>
  )
}

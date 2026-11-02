'use client'

import { formatInTimeZone } from 'date-fns-tz'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { APPOINTMENT_STATUS_COLORS } from '@/lib/constants'
import { BR_TZ, formatBrDate, parseBrDate, toBrYmd } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  usePatientAppointments,
  type PatientAppointment,
} from '@/hooks/queries/use-patient-overview'

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
  pending_reschedule: 'Reagendar',
}

export function isUpcomingAppointment(
  a: { date: string; startTime: string },
  now: Date = new Date(),
): boolean {
  const today = toBrYmd(now)
  if (a.date !== today) return a.date > today
  return a.startTime.slice(0, 5) >= formatInTimeZone(now, BR_TZ, 'HH:mm')
}

export function formatAppointmentDate(ymd: string): string {
  return formatBrDate(parseBrDate(ymd, '12:00:00'))
}

export function AppointmentStatusChip({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(APPOINTMENT_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600')}
    >
      {APPOINTMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

function AppointmentRow({ appointment }: { appointment: PatientAppointment }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal">
          {formatAppointmentDate(appointment.date)} às {appointment.startTime.slice(0, 5)}
        </p>
        <p className="truncate text-xs text-mid">
          {[appointment.procedureTypeName, appointment.practitionerName]
            .filter(Boolean)
            .join(' · ') || 'Sem detalhes'}
        </p>
      </div>
      <AppointmentStatusChip status={appointment.status} />
    </li>
  )
}

function AppointmentList({
  title,
  items,
  emptyText,
}: {
  title: string
  items: PatientAppointment[]
  emptyText: string
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-charcoal">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-[3px] bg-white px-4 py-6 text-center text-sm text-mid shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-sage/10 rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {items.map((a) => (
            <AppointmentRow key={a.id} appointment={a} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function PatientAgendaSection({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = usePatientAppointments(patientId)

  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError) return <p className="text-sm text-red-600">Erro ao carregar agendamentos.</p>

  const all = data ?? []
  const now = new Date()
  const upcoming = all
    .filter((a) => isUpcomingAppointment(a, now))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
  const past = all
    .filter((a) => !isUpcomingAppointment(a, now))
    .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`))

  return (
    <div className="space-y-6">
      <AppointmentList title="Próximos" items={upcoming} emptyText="Nenhum agendamento futuro" />
      <AppointmentList title="Anteriores" items={past} emptyText="Nenhum agendamento anterior" />
    </div>
  )
}

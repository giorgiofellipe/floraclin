import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CalendarDays, Sun } from 'lucide-react'
import type { TodayAppointment } from '@/db/queries/dashboard'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluido',
  cancelled: 'Cancelado',
  no_show: 'Nao compareceu',
}

const STATUS_DOT_COLORS: Record<string, string> = {
  scheduled: 'bg-sage/60',
  confirmed: 'bg-mint',
  in_progress: 'bg-amber',
  completed: 'bg-mid/40',
  cancelled: 'bg-red-400',
  no_show: 'bg-amber-dark',
}

interface TodayAppointmentsProps {
  appointments: TodayAppointment[]
}

export function TodayAppointments({ appointments }: TodayAppointmentsProps) {
  return (
    <Card className="border-0 shadow-sm bg-white rounded-xl" data-testid="dashboard-appointments">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-sage" />
          <span className="text-xs font-medium uppercase tracking-wider text-mid">
            Agenda de hoje
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-petal mb-4">
              <Sun className="h-7 w-7 text-gold" />
            </div>
            <p className="text-charcoal font-medium">Dia livre!</p>
            <p className="mt-1 text-sm text-mid">
              Nenhum agendamento para hoje. Aproveite para organizar sua agenda.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-petal/60">
            {appointments.map((appt) => {
              const displayName =
                appt.patientName ?? appt.bookingName ?? 'Sem paciente'
              const statusDot =
                STATUS_DOT_COLORS[appt.status] ?? 'bg-mid/40'
              const statusLabel =
                STATUS_LABELS[appt.status] ?? appt.status
              const href = appt.patientId
                ? `/pacientes/${appt.patientId}`
                : '#'

              return (
                <Link
                  key={appt.id}
                  href={href}
                  className="group flex items-center gap-4 py-3 px-2 -mx-2 rounded-lg transition-all duration-200 hover:bg-petal/30"
                >
                  {/* Time column */}
                  <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-forest">
                    {appt.startTime.slice(0, 5)}
                  </span>

                  {/* Patient info */}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-charcoal truncate">
                      {displayName}
                    </p>
                    {appt.procedureTypeName && (
                      <span className="inline-block mt-0.5 text-xs text-mid bg-petal/60 rounded-full px-2 py-0.5">
                        {appt.procedureTypeName}
                      </span>
                    )}
                  </div>

                  {/* Status dot + label */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`h-2 w-2 rounded-full ${statusDot}`} title={statusLabel} />
                    <span className="text-xs text-mid hidden sm:inline">
                      {statusLabel}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarDays } from 'lucide-react'
import { APPOINTMENT_STATUS_COLORS } from '@/lib/constants'
import type { TodayAppointment } from '@/db/queries/dashboard'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
}

interface TodayAppointmentsProps {
  appointments: TodayAppointment[]
}

export function TodayAppointments({ appointments }: TodayAppointmentsProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-forest">
          <CalendarDays className="h-5 w-5" />
          Agenda de hoje
        </CardTitle>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <p className="py-8 text-center text-mid">
            Nenhum agendamento para hoje
          </p>
        ) : (
          <div className="space-y-3">
            {appointments.map((appt) => {
              const displayName =
                appt.patientName ?? appt.bookingName ?? 'Sem paciente'
              const statusColor =
                APPOINTMENT_STATUS_COLORS[appt.status] ?? 'bg-petal text-mid'
              const href = appt.patientId
                ? `/pacientes/${appt.patientId}`
                : '#'

              return (
                <Link
                  key={appt.id}
                  href={href}
                  className="flex items-center justify-between rounded-lg border border-transparent p-3 transition-colors hover:border-sage/20 hover:bg-petal/50"
                >
                  <div className="flex items-center gap-4">
                    <span className="w-[4.5rem] text-sm font-medium text-forest">
                      {appt.startTime.slice(0, 5)}
                    </span>
                    <div>
                      <p className="font-medium text-charcoal">
                        {displayName}
                      </p>
                      {appt.procedureTypeName && (
                        <p className="text-sm text-mid">
                          {appt.procedureTypeName}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`${statusColor} border-0`}
                  >
                    {STATUS_LABELS[appt.status] ?? appt.status}
                  </Badge>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

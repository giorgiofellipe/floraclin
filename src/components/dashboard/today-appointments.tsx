import Link from 'next/link'
import type { TodayAppointment } from '@/db/queries/dashboard'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Aguardando',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluido',
  cancelled: 'Cancelado',
  no_show: 'Nao compareceu',
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  scheduled: 'bg-[#FFF4EF] text-[#D4845A]',
  confirmed: 'bg-[#F0F7F1] text-[#4A6B52]',
  in_progress: 'bg-[#FFF4EF] text-[#D4845A]',
  completed: 'bg-[#F0F7F1] text-[#4A6B52]',
  cancelled: 'bg-[#F5F5F5] text-[#7A7A7A]',
  no_show: 'bg-[#FFF4EF] text-[#D4845A]',
}

const STATUS_BORDER_COLORS: Record<string, string> = {
  scheduled: 'border-l-[#D4845A]',
  confirmed: 'border-l-[#8FB49A]',
  in_progress: 'border-l-[#D4845A]',
  completed: 'border-l-[#8FB49A]',
  cancelled: 'border-l-[#D0D0D0]',
  no_show: 'border-l-[#D4845A]',
}

interface TodayAppointmentsProps {
  appointments: TodayAppointment[]
}

export function TodayAppointments({ appointments }: TodayAppointmentsProps) {
  return (
    <div
      className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-5"
      data-testid="dashboard-appointments"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[14px] font-medium text-[#2A2A2A]">
          Agenda de Hoje
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#7A7A7A]">
          {appointments.length} CONSULTA{appointments.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {appointments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <p className="text-[14px] font-medium text-[#2A2A2A]">Dia livre!</p>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            Nenhum agendamento para hoje.
          </p>
        </div>
      ) : (
        <div>
          {appointments.map((appt, index) => {
            const displayName =
              appt.patientName ?? appt.bookingName ?? 'Sem paciente'
            const statusLabel =
              STATUS_LABELS[appt.status] ?? appt.status
            const statusBadge =
              STATUS_BADGE_STYLES[appt.status] ?? 'bg-[#F5F5F5] text-[#7A7A7A]'
            const borderColor =
              STATUS_BORDER_COLORS[appt.status] ?? 'border-l-[#D0D0D0]'
            const href = appt.patientId
              ? `/pacientes/${appt.patientId}`
              : '#'

            const timeStr = appt.startTime.slice(0, 5).replace(':', 'h')

            return (
              <div key={appt.id}>
                <Link
                  href={href}
                  className={`flex items-center justify-between py-3 pl-3 border-l-[3px] ${borderColor}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-[#2A2A2A] truncate">
                      {displayName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[#7A7A7A]">
                      {timeStr}
                      {appt.procedureTypeName && ` · ${appt.procedureTypeName}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${statusBadge}`}
                  >
                    {statusLabel}
                  </span>
                </Link>
                {index < appointments.length - 1 && (
                  <div className="border-b border-[#F0F0F0]" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

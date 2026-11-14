'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarPlusIcon, Link2Icon, MoreHorizontalIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PaymentForm } from '@/components/financial/payment-form'
import { ReadOnlyGuard, useSubscriptionAccess, useWriteGuard } from '@/components/layout/subscription-access'
import { useAppointmentStatusChange } from '@/hooks/mutations/use-appointment-status-change'
import {
  ACTIVE_STATUSES,
  SETTLED_STATUSES,
  atendimentoHref,
  canWriteAppointments,
  patientHref,
  primaryAppointmentAction,
  type PrimaryActionKind,
} from '@/lib/appointment-actions'
import { APPOINTMENT_STATUS_DOT, APPOINTMENT_STATUS_LABELS } from '@/lib/appointment-status'
import { NEW_APPOINTMENT_PATH } from '@/lib/deep-links'
import { cn } from '@/lib/utils'
import type { TodayAppointment } from '@/db/queries/dashboard'
import type { Role } from '@/types'

/** Thumb-sized on phones; desktop keeps the compact size. */
const ROW_ACTION = 'max-sm:h-11 max-sm:px-4'

interface TodayAppointmentsProps {
  appointments: TodayAppointment[]
  /** No appointment was ever created: the empty state leads to the first one. */
  firstAppointment?: boolean
  bookingUrl?: string | null
  /** Practitioners get no money card, so their month count lives here. */
  monthAtendimentos?: number | null
}

export function TodayAppointments({ appointments, firstAppointment = false, bookingUrl = null, monthAtendimentos = null }: TodayAppointmentsProps) {
  const router = useRouter()
  const { role } = useSubscriptionAccess()
  const { changeStatus, pendingIds } = useAppointmentStatusChange()
  const [charging, setCharging] = useState<TodayAppointment | null>(null)

  const open = appointments.filter((a) => !SETTLED_STATUSES.has(a.status)).length
  const summary = appointments.length === 0 ? null : open === 0 ? 'Tudo resolvido' : `${open} de ${appointments.length} em aberto`

  return (
    <section
      aria-labelledby="today-title"
      className="rounded-lg bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      data-testid="dashboard-appointments"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="today-title" className="text-[15px] font-semibold text-charcoal">Hoje</h2>
        <span className="text-right text-[13px] text-mid">
          {[summary, monthAtendimentos !== null ? `${monthAtendimentos} atendimentos este mês` : null].filter(Boolean).join(' · ')}
        </span>
      </div>

      {appointments.length === 0 ? (
        <EmptyDay firstAppointment={firstAppointment} bookingUrl={bookingUrl} />
      ) : (
        <ul className="divide-y divide-topbar-border">
          {appointments.map((appt) => (
            <AppointmentRow
              key={appt.id}
              appt={appt}
              role={role as Role}
              pending={pendingIds.has(appt.id)}
              onStatus={(status) => changeStatus(appt, status)}
              onStart={() => changeStatus(appt, 'in_progress', () => router.push(atendimentoHref(appt)))}
              onCharge={() => setCharging(appt)}
            />
          ))}
        </ul>
      )}

      {charging?.patientId && (
        <PaymentForm
          open
          onClose={() => setCharging(null)}
          onSuccess={() => setCharging(null)}
          defaultPatient={{ id: charging.patientId, fullName: charging.patientName ?? '' }}
          appointmentId={charging.id}
          defaultDescription={charging.procedureTypeName ?? undefined}
        />
      )}
    </section>
  )
}

function AppointmentRow({
  appt,
  role,
  pending,
  onStatus,
  onStart,
  onCharge,
}: {
  appt: TodayAppointment
  role: Role
  pending: boolean
  onStatus: (status: string) => void
  onStart: () => void
  onCharge: () => void
}) {
  const guard = useWriteGuard()
  const name = appt.patientName ?? appt.bookingName ?? 'Sem paciente'
  const settled = SETTLED_STATUSES.has(appt.status)
  const action = primaryAppointmentAction(appt, role)
  const label = action?.short ? (
    <>
      <span className="sm:hidden">{action.short}</span>
      <span className="max-sm:hidden">{action.label}</span>
    </>
  ) : (
    action?.label
  )

  let control: React.ReactNode = null
  if (action?.kind === 'register') {
    control = (
      <Link href={patientHref(appt)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), ROW_ACTION)}>
        {label}
      </Link>
    )
  } else if (action?.kind === 'open') {
    control = (
      <Link href={atendimentoHref(appt)} className={cn(buttonVariants({ size: 'sm' }), ROW_ACTION)}>
        {label}
      </Link>
    )
  } else if (action) {
    const handlers: Record<PrimaryActionKind, () => void> = { status: () => onStatus('confirmed'), start: onStart, charge: onCharge, open: () => {}, register: () => {} }
    const onClick = handlers[action.kind]
    control = (
      <Button size="sm" variant={action.kind === 'charge' ? 'outline' : 'default'} className={ROW_ACTION} disabled={pending} onClick={onClick}>
        {label}
      </Button>
    )
  }

  return (
    <li className="flex items-center gap-3 py-3" data-testid="today-row" data-status={appt.status}>
      <span className={cn('w-11 shrink-0 text-[13px] font-medium tabular-nums', settled ? 'text-mid' : 'text-charcoal')}>
        {appt.startTime.slice(0, 5)}
      </span>
      <Link href={patientHref(appt)} className="min-w-0 flex-1 rounded-sm">
        <p className={cn('truncate text-[14px] font-medium', settled ? 'text-mid' : 'text-charcoal')}>{name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-mid">
          <span className={cn('size-1.5 shrink-0 rounded-full', APPOINTMENT_STATUS_DOT[appt.status] ?? 'bg-slate-300')} aria-hidden />
          {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
          {appt.procedureTypeName && <span className="truncate">· {appt.procedureTypeName}</span>}
        </p>
      </Link>
      {control && action && <ReadOnlyGuard label={action.label}>{control}</ReadOnlyGuard>}
      {ACTIVE_STATUSES.has(appt.status) && canWriteAppointments(role) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="-mr-2 size-11 shrink-0 text-mid hover:text-charcoal" aria-label={`Mais ações para ${name}`}>
                <MoreHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="min-h-11" disabled={pending} onClick={guard(() => onStatus('completed'))}>
              Marcar como concluído
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" disabled={pending} onClick={guard(() => onStatus('no_show'))}>
              Não compareceu
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" render={<Link href={patientHref(appt)} />}>
              {appt.patientId ? 'Abrir paciente' : 'Cadastrar paciente'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

function EmptyDay({ firstAppointment, bookingUrl }: { firstAppointment: boolean; bookingUrl: string | null }) {
  async function copyBookingLink() {
    if (!bookingUrl) return
    try {
      await navigator.clipboard.writeText(bookingUrl)
      toast.success('Link de agendamento copiado')
    } catch {
      toast.error('Não foi possível copiar o link')
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-[14px] font-medium text-charcoal">{firstAppointment ? 'Sua agenda está pronta' : 'Agenda livre hoje'}</p>
      <p className="max-w-xs text-[13px] text-mid">
        {firstAppointment
          ? 'Marque o primeiro atendimento ou envie o link para o paciente agendar sozinho.'
          : 'Encaixe um paciente ou compartilhe o link de agendamento online.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <ReadOnlyGuard label="Agendar">
          <Link href={NEW_APPOINTMENT_PATH} className={buttonVariants()} data-testid="empty-day-schedule">
            <CalendarPlusIcon className="size-4" data-icon="inline-start" />
            {firstAppointment ? 'Agendar primeiro atendimento' : 'Agendar'}
          </Link>
        </ReadOnlyGuard>
        {bookingUrl && (
          <Button variant="outline" onClick={copyBookingLink}>
            <Link2Icon className="size-4" data-icon="inline-start" />
            Copiar link de agendamento
          </Button>
        )}
      </div>
    </div>
  )
}

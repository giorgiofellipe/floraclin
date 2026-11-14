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
import { useUpdateAppointmentStatus } from '@/hooks/mutations/use-appointment-mutations'
import { canWriteClinical } from '@/lib/constants'
import { NEW_APPOINTMENT_PATH, NEW_PATIENT_PATH } from '@/lib/deep-links'
import { cn } from '@/lib/utils'
import type { TodayAppointment } from '@/db/queries/dashboard'
import type { Role } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
  pending_reschedule: 'Aguardando reagendamento',
}

const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-blue-400',
  confirmed: 'bg-emerald-500',
  in_progress: 'bg-indigo-500',
  completed: 'bg-slate-300',
  cancelled: 'bg-red-300',
  no_show: 'bg-rose-400',
  pending_reschedule: 'bg-amber-400',
}

/** Rows that need nothing more today; their text steps back, their actions do not. */
const SETTLED = new Set(['completed', 'cancelled', 'no_show'])
const ACTIVE = new Set(['scheduled', 'confirmed', 'in_progress'])

// Mirrors the API: PUT /api/appointments/[id]/status and POST /api/financial.
const CAN_SET_STATUS = new Set<string>(['owner', 'practitioner', 'receptionist'])
const CAN_CHARGE = new Set<string>(['owner', 'receptionist', 'financial'])

/** Thumb-sized on phones; desktop keeps the compact size. */
const ROW_ACTION = 'max-sm:h-11 max-sm:px-4'

function patientHref(appt: TodayAppointment): string {
  return appt.patientId
    ? `/pacientes/${appt.patientId}`
    : `${NEW_PATIENT_PATH}&nome=${encodeURIComponent(appt.bookingName ?? '')}&telefone=${encodeURIComponent(appt.bookingPhone ?? '')}`
}

function atendimentoHref(appt: TodayAppointment): string {
  return `/pacientes/${appt.patientId}/atendimento?appointment=${appt.id}`
}

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
  const updateStatus = useUpdateAppointmentStatus()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [charging, setCharging] = useState<TodayAppointment | null>(null)

  function setPending(id: string, pending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function changeStatus(appt: TodayAppointment, status: string, then?: () => void) {
    const previous = appt.status
    const name = appt.patientName ?? appt.bookingName ?? 'Agendamento'
    setPending(appt.id, true)
    updateStatus.mutate(
      { id: appt.id, status },
      {
        onSuccess: () => {
          toast.success(`${name}: ${STATUS_LABELS[status] ?? status}`, {
            action: {
              label: 'Desfazer',
              onClick: () =>
                updateStatus.mutate({ id: appt.id, status: previous }, { onError: (err) => toast.error(err.message) }),
            },
          })
          then?.()
        },
        onError: (err) => toast.error(err.message),
        onSettled: () => setPending(appt.id, false),
      },
    )
  }

  const open = appointments.filter((a) => !SETTLED.has(a.status)).length
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

type ActionKind = 'status' | 'start' | 'open' | 'charge' | 'register'

/** The one thing to do next on a row, if this role may do it. */
function primaryAction(appt: TodayAppointment, role: Role): { label: string; short?: string; kind: ActionKind } | null {
  if (!appt.patientId) return ACTIVE.has(appt.status) ? { label: 'Cadastrar', kind: 'register' } : null
  if (appt.status === 'scheduled' && CAN_SET_STATUS.has(role)) return { label: 'Confirmar', kind: 'status' }
  if (appt.status === 'confirmed' && canWriteClinical(role)) return { label: 'Iniciar atendimento', short: 'Atender', kind: 'start' }
  if (appt.status === 'in_progress' && canWriteClinical(role)) return { label: 'Abrir atendimento', short: 'Abrir', kind: 'open' }
  if (appt.status === 'completed' && !appt.hasCharge && CAN_CHARGE.has(role)) return { label: 'Cobrar', kind: 'charge' }
  return null
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
  const settled = SETTLED.has(appt.status)
  const action = primaryAction(appt, role)
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
    const handlers: Record<ActionKind, () => void> = { status: () => onStatus('confirmed'), start: onStart, charge: onCharge, open: () => {}, register: () => {} }
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
          <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[appt.status] ?? 'bg-slate-300')} aria-hidden />
          {STATUS_LABELS[appt.status] ?? appt.status}
          {appt.procedureTypeName && <span className="truncate">· {appt.procedureTypeName}</span>}
        </p>
      </Link>
      {control && action && <ReadOnlyGuard label={action.label}>{control}</ReadOnlyGuard>}
      {ACTIVE.has(appt.status) && CAN_SET_STATUS.has(role) && (
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

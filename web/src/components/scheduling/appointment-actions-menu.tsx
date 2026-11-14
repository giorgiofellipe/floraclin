'use client'

import Link from 'next/link'
import {
  CalendarClockIcon,
  CalendarPlusIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CirclePlayIcon,
  PencilIcon,
  StethoscopeIcon,
  UserIcon,
  UserXIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react'
import { AnchoredPanel } from '@/components/scheduling/anchored-panel'
import { StatusChip, appointmentDisplayName } from '@/components/scheduling/appointment-card'
import { useSubscriptionAccess, useWriteGuard } from '@/components/layout/subscription-access'
import { agendaMenuActions, atendimentoHref, canWriteAppointments, patientHref, type AgendaMenuAction } from '@/lib/appointment-actions'
import { cn } from '@/lib/utils'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { Role } from '@/types'

export interface AppointmentMenuHandlers {
  onStatus: (appointment: AppointmentWithDetails, status: string) => void
  onStart: (appointment: AppointmentWithDetails) => void
  onReschedule: (appointment: AppointmentWithDetails) => void
  onEdit: (appointment: AppointmentWithDetails) => void
  onCancel: (appointment: AppointmentWithDetails) => void
  /** Books another appointment at the same time (a second practitioner, a double booking). */
  onNewHere: (appointment: AppointmentWithDetails, anchor: HTMLElement | null) => void
}

const ITEM = 'flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-charcoal transition-colors hover:bg-content-bg [@media(pointer:coarse)]:min-h-12 max-sm:min-h-12'

const ICONS: Record<AgendaMenuAction, LucideIcon> = {
  confirm: CircleCheckIcon,
  start: CirclePlayIcon,
  'open-atendimento': StethoscopeIcon,
  complete: CheckCheckIcon,
  'no-show': UserXIcon,
  patient: UserIcon,
  reschedule: CalendarClockIcon,
  edit: PencilIcon,
  'new-here': CalendarPlusIcon,
  cancel: XCircleIcon,
}

interface AppointmentActionsMenuProps extends AppointmentMenuHandlers {
  open: boolean
  /** Stays set after closing so the panel keeps its content while it animates out. */
  appointment: AppointmentWithDetails | null
  anchor: Element | null
  role: Role
  onClose: () => void
}

/** The tapped appointment's next steps: only valid statuses, only what this role may do. */
export function AppointmentActionsMenu({ open, appointment: appt, anchor, role, onClose, ...handlers }: AppointmentActionsMenuProps) {
  const { readOnly } = useSubscriptionAccess()
  const guard = useWriteGuard()
  const run = (action: () => void, needsWrite = true) => () => {
    onClose()
    if (needsWrite) guard(action)()
    else action()
  }

  const labels: Record<AgendaMenuAction, string> = {
    confirm: 'Confirmar',
    start: 'Iniciar atendimento',
    'open-atendimento': 'Abrir atendimento',
    complete: 'Marcar como concluído',
    'no-show': 'Não compareceu',
    patient: appt?.patientId ? 'Abrir paciente' : 'Cadastrar paciente',
    reschedule: 'Reagendar',
    edit: readOnly || !canWriteAppointments(role) ? 'Ver agendamento' : 'Editar agendamento',
    'new-here': 'Novo agendamento neste horário',
    cancel: 'Cancelar agendamento',
  }

  return (
    <AnchoredPanel
      open={open}
      onOpenChange={(open) => !open && onClose()}
      anchor={anchor}
      title={appt ? `Ações de ${appointmentDisplayName(appt)}` : 'Ações'}
      className="w-64 p-1.5"
      testId="appointment-context-menu"
    >
      {appt && (
        <>
          <div className="mb-1 border-b border-topbar-border px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-medium text-charcoal">{appointmentDisplayName(appt)}</p>
            <p className="text-xs text-mid tabular-nums">
              {appt.startTime.slice(0, 5)}-{appt.endTime.slice(0, 5)} · {appt.practitionerName}
            </p>
            <StatusChip status={appt.status} className="mt-1.5 bg-content-bg" />
          </div>
          <div className="grid">
            {agendaMenuActions(appt, role).map((action) => {
              const Icon = ICONS[action]
              const content = (
                <>
                  <Icon className={cn('size-4 shrink-0', action === 'cancel' ? 'text-red-600' : 'text-mid')} aria-hidden />
                  {labels[action]}
                </>
              )
              const testId = `context-${action}`
              if (action === 'patient' || action === 'open-atendimento') {
                return (
                  <Link
                    key={action}
                    href={action === 'patient' ? patientHref(appt) : atendimentoHref(appt)}
                    className={ITEM}
                    onClick={onClose}
                    data-testid={testId}
                  >
                    {content}
                  </Link>
                )
              }
              const onClick = {
                confirm: run(() => handlers.onStatus(appt, 'confirmed')),
                start: run(() => handlers.onStart(appt)),
                complete: run(() => handlers.onStatus(appt, 'completed')),
                'no-show': run(() => handlers.onStatus(appt, 'no_show')),
                reschedule: run(() => handlers.onReschedule(appt)),
                edit: run(() => handlers.onEdit(appt), false),
                'new-here': run(() => handlers.onNewHere(appt, anchor instanceof HTMLElement ? anchor : null)),
                cancel: run(() => handlers.onCancel(appt)),
              }[action]
              return (
                <button
                  key={action}
                  type="button"
                  className={cn(ITEM, action === 'cancel' && 'mt-1 border-t border-topbar-border text-red-600 hover:bg-red-50')}
                  onClick={onClick}
                  data-testid={testId}
                >
                  {content}
                </button>
              )
            })}
          </div>
        </>
      )}
    </AnchoredPanel>
  )
}

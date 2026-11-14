import { canWriteClinical } from '@/lib/constants'
import { NEW_PATIENT_PATH } from '@/lib/deep-links'
import { MOVABLE_STATUSES } from '@/lib/appointment-status'
import type { Role } from '@/types'

// Mirrors the API: PUT /api/appointments (and /status) and POST /api/financial.
const CAN_WRITE_APPOINTMENTS = new Set<string>(['owner', 'practitioner', 'receptionist'])
const CAN_CHARGE = new Set<string>(['owner', 'receptionist', 'financial'])

export function canWriteAppointments(role: Role): boolean {
  return CAN_WRITE_APPOINTMENTS.has(role)
}

export function canCharge(role: Role): boolean {
  return CAN_CHARGE.has(role)
}

/** Rows that need nothing more today. */
export const SETTLED_STATUSES = new Set(['completed', 'cancelled', 'no_show'])
export const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed', 'in_progress'])

interface ActionableAppointment {
  id: string
  status: string
  patientId: string | null
  bookingName: string | null
  bookingPhone: string | null
  /** Only the dashboard knows this; the agenda never offers "Cobrar". */
  hasCharge?: boolean
}

export function patientHref(appt: ActionableAppointment): string {
  return appt.patientId
    ? `/pacientes/${appt.patientId}`
    : `${NEW_PATIENT_PATH}&nome=${encodeURIComponent(appt.bookingName ?? '')}&telefone=${encodeURIComponent(appt.bookingPhone ?? '')}`
}

export function atendimentoHref(appt: Pick<ActionableAppointment, 'id' | 'patientId'>): string {
  return `/pacientes/${appt.patientId}/atendimento?appointment=${appt.id}`
}

export type PrimaryActionKind = 'status' | 'start' | 'open' | 'charge' | 'register'

/** The one thing to do next on an appointment, if this role may do it. */
export function primaryAppointmentAction(
  appt: ActionableAppointment,
  role: Role,
): { label: string; short?: string; kind: PrimaryActionKind } | null {
  // Registering posts to /api/patients, which takes the same roles as appointment writes.
  if (!appt.patientId) return ACTIVE_STATUSES.has(appt.status) && canWriteAppointments(role) ? { label: 'Cadastrar', kind: 'register' } : null
  if (appt.status === 'scheduled' && canWriteAppointments(role)) return { label: 'Confirmar', kind: 'status' }
  if (appt.status === 'confirmed' && canWriteClinical(role)) return { label: 'Iniciar atendimento', short: 'Atender', kind: 'start' }
  if (appt.status === 'in_progress' && canWriteClinical(role)) return { label: 'Abrir atendimento', short: 'Abrir', kind: 'open' }
  if (appt.status === 'completed' && appt.hasCharge === false && canCharge(role)) return { label: 'Cobrar', kind: 'charge' }
  return null
}

export type AgendaMenuAction =
  | 'confirm'
  | 'start'
  | 'open-atendimento'
  | 'complete'
  | 'no-show'
  | 'patient'
  | 'reschedule'
  | 'edit'
  | 'new-here'
  | 'cancel'

/** The agenda context menu: only the next statuses that make sense, only what the API lets this role do. */
export function agendaMenuActions(appt: ActionableAppointment, role: Role): AgendaMenuAction[] {
  const write = canWriteAppointments(role)
  const clinical = canWriteClinical(role) && !!appt.patientId
  const actions: AgendaMenuAction[] = []
  const { status } = appt

  if (write && status === 'scheduled') actions.push('confirm')
  if (clinical && (status === 'scheduled' || status === 'confirmed')) actions.push('start')
  if (clinical && status === 'in_progress') actions.push('open-atendimento')
  if (write && status === 'in_progress') actions.push('complete')
  if (write && (status === 'scheduled' || status === 'confirmed')) actions.push('no-show')
  if (appt.patientId || write) actions.push('patient')
  if (write && MOVABLE_STATUSES.has(status)) actions.push('reschedule')
  // Roles that cannot write still open the appointment, read-only.
  actions.push('edit')
  if (write) actions.push('new-here')
  if (write && !SETTLED_STATUSES.has(status)) actions.push('cancel')
  return actions
}

import { z } from 'zod'
import type { AppointmentStatus } from '@/types'

const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'pending_reschedule'] as const

export const createAppointmentSchema = z.object({
  patientId: z.string().uuid('Paciente inválido').nullable().optional(),
  practitionerId: z.string().uuid('Profissional inválido'),
  procedureTypeId: z.string().uuid('Tipo de procedimento inválido').nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inicial inválido'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horário final inválido'),
  notes: z.string().max(2000, 'Observações devem ter no máximo 2000 caracteres').optional(),
  source: z.enum(['internal', 'online_booking']).default('internal'),
  bookingName: z.string().max(255).optional(),
  bookingPhone: z.string().max(20).optional(),
  bookingEmail: z.string().email('E-mail inválido').optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: 'Horário inicial deve ser anterior ao horário final', path: ['endTime'] }
)

export const updateAppointmentSchema = z.object({
  id: z.string().uuid('Agendamento inválido'),
  patientId: z.string().uuid('Paciente inválido').nullable().optional(),
  practitionerId: z.string().uuid('Profissional inválido').optional(),
  procedureTypeId: z.string().uuid('Tipo de procedimento inválido').nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inicial inválido').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horário final inválido').optional(),
  notes: z.string().max(2000).optional(),
  notifyPatient: z.boolean().optional(),
  /** Undo: refuse when the appointment changed after the move being undone. */
  expectedUpdatedAt: z.string().datetime().optional(),
  /** Undo: the confirmation state the move reset, as the move's response returned it. */
  restore: z
    .object({
      status: z.enum(APPOINTMENT_STATUSES),
      confirmedAt: z.string().datetime().nullable(),
      confirmationSentAt: z.string().datetime().nullable(),
      confirmationMessageId: z.string().max(100).nullable(),
    })
    .optional(),
})

export const updateStatusSchema = z.object({
  id: z.string().uuid('Agendamento inválido'),
  status: z.enum(APPOINTMENT_STATUSES, {
    message: 'Status inválido',
  }),
  /** Undo: refuse when the appointment changed after the status change being undone. */
  expectedUpdatedAt: z.string().datetime().optional(),
})

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>

const RESCHEDULE_NOTICE_STATUSES: readonly string[] = ['scheduled', 'confirmed', 'pending_reschedule'] satisfies AppointmentStatus[]

/** A moved appointment the patient still has to attend. `todayYmd` is the BR today. */
export function canSendRescheduleNotice(status: string, newDate: string, todayYmd: string): boolean {
  return RESCHEDULE_NOTICE_STATUSES.includes(status) && newDate >= todayYmd
}

export const STALE_UNDO_MESSAGE = 'O agendamento mudou depois disso. Nada foi desfeito.'

import { z } from 'zod'

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
})

export const updateStatusSchema = z.object({
  id: z.string().uuid('Agendamento inválido'),
  status: z.enum(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'], {
    message: 'Status inválido',
  }),
})

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>

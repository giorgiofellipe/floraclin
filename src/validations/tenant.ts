import { z } from 'zod'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'

const addressSchema = z.object({
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
}).optional()

const dayScheduleSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Formato inválido (HH:MM)'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Formato inválido (HH:MM)'),
  enabled: z.boolean(),
})

const workingHoursSchema = z.object({
  mon: dayScheduleSchema,
  tue: dayScheduleSchema,
  wed: dayScheduleSchema,
  thu: dayScheduleSchema,
  fri: dayScheduleSchema,
  sat: dayScheduleSchema,
  sun: dayScheduleSchema,
})

const tenantSettingsSchema = z.object({
  publicBookingEnabled: z.boolean().optional(),
}).passthrough()

export const updateTenantSchema = z.object({
  name: z.string().min(1, 'Nome da clínica é obrigatório'),
  phone: z.string().optional().or(z.literal('')),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  address: addressSchema,
  workingHours: workingHoursSchema.optional(),
  settings: tenantSettingsSchema.optional(),
})

export const procedureTypeSchema = z.object({
  name: z.string().min(1, 'Nome do procedimento é obrigatório'),
  category: z.enum(PROCEDURE_CATEGORIES, {
    message: 'Categoria inválida',
  }),
  description: z.string().optional().or(z.literal('')),
  defaultPrice: z.string().optional().or(z.literal('')),
  estimatedDurationMin: z.coerce.number().int().min(5, 'Mínimo 5 minutos').max(480, 'Máximo 8 horas').optional(),
  isActive: z.boolean().optional(),
})

export const updateProcedureTypeSchema = procedureTypeSchema.extend({
  id: z.string().uuid('ID inválido'),
})

export const bookingSettingsSchema = z.object({
  publicBookingEnabled: z.boolean(),
})

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>
export type ProcedureTypeInput = z.infer<typeof procedureTypeSchema>
export type UpdateProcedureTypeInput = z.infer<typeof updateProcedureTypeSchema>
export type WorkingHours = z.infer<typeof workingHoursSchema>
export type BookingSettingsInput = z.infer<typeof bookingSettingsSchema>

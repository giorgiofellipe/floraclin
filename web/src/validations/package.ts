import { z } from 'zod'

const paymentMethods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer'] as const

export const packageTemplateLineSchema = z.object({
  procedureTypeId: z.string().uuid('Procedimento inválido'),
  sessionsCount: z.number().int().min(1, 'Mínimo 1 sessão'),
  sortOrder: z.number().int().min(0).default(0),
})

export const packageTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255),
  description: z.string().optional().nullable(),
  defaultPrice: z.number().nonnegative('Preço deve ser positivo').optional().nullable(),
  validityMonths: z.number().int().min(1, 'Mínimo 1 mês').optional().nullable(),
  lines: z.array(packageTemplateLineSchema).min(1, 'Pelo menos uma linha é obrigatória'),
})

export const updatePackageTemplateSchema = packageTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const sellPackageSchema = z.object({
  patientId: z.string().uuid('Paciente inválido'),
  templateId: z.string().uuid().nullable(),
  name: z.string().min(1, 'Nome é obrigatório').max(255),
  totalAmount: z.number().nonnegative('Valor deve ser positivo ou zero'),
  validityMonths: z.number().int().min(1).optional().nullable(),
  lines: z.array(z.object({
    procedureTypeId: z.string().uuid('Procedimento inválido'),
    procedureTypeName: z.string().min(1).max(255),
    sessionsTotal: z.number().int().min(1, 'Mínimo 1 sessão'),
  })).min(1, 'Pelo menos uma linha é obrigatória'),
  paymentMethod: z.enum(paymentMethods, { message: 'Método de pagamento inválido' }),
  installmentCount: z.number().int().min(1).max(24).default(1),
})

export const cancelPackageSchema = z.object({
  reason: z.string().min(1, 'Motivo é obrigatório').max(2000),
})

export const startPackageSessionSchema = z.object({
  allowExpiredOverride: z.boolean().optional(),
})

export type PackageTemplateInput = z.infer<typeof packageTemplateSchema>
export type UpdatePackageTemplateInput = z.infer<typeof updatePackageTemplateSchema>
export type SellPackageInput = z.infer<typeof sellPackageSchema>
export type CancelPackageInput = z.infer<typeof cancelPackageSchema>
export type StartPackageSessionInput = z.infer<typeof startPackageSessionSchema>

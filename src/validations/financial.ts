import { z } from 'zod'
import type { PaymentMethod } from '@/types'

const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
const financialStatuses = ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'renegotiated'] as const

export const createFinancialEntrySchema = z.object({
  patientId: z.string().uuid('Paciente inválido'),
  procedureRecordId: z.string().uuid('Procedimento inválido').optional(),
  appointmentId: z.string().uuid('Agendamento inválido').optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(12, 'Máximo 12 parcelas'),
  customDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')).optional(),
  notes: z.string().optional(),
})

export const recordPaymentSchema = z.object({
  installmentId: z.string().uuid('Parcela inválida'),
  amount: z.number().positive('Valor deve ser positivo'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(), // ISO string, defaults to now
  notes: z.string().optional(),
})

export const renegotiateSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  newInstallmentCount: z.number().int().min(1).max(24),
  newTotalAmount: z.number().positive().optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  waivePenalties: z.boolean().optional().default(false),
  waiveAmount: z.number().min(0).optional().default(0),
  customDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')).optional(),
})

export const bulkPaySchema = z.object({
  installmentIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma parcela'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(),
})

export const bulkCancelSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  reason: z.string().min(1, 'Motivo é obrigatório'),
})

// Keep existing for backwards compat
export const payInstallmentSchema = z.object({
  installmentId: z.string().uuid('Parcela inválida'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
})

export const financialFilterSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(financialStatuses as [string, ...string[]]).optional(),
  isOverdue: z.boolean().optional(),
  isPartial: z.boolean().optional(),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const revenueFilterSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (esperado YYYY-MM-DD)'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (esperado YYYY-MM-DD)'),
  practitionerId: z.string().uuid().optional(),
})

export const ledgerFilterSchema = z.object({
  type: z.enum(['inflow', 'outflow', 'all'] as [string, ...string[]]).optional().default('all'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  patientId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (esperado YYYY-MM-DD)'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (esperado YYYY-MM-DD)'),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(50),
})

export type CreateFinancialEntryInput = z.infer<typeof createFinancialEntrySchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type RenegotiateInput = z.infer<typeof renegotiateSchema>
export type BulkPayInput = z.infer<typeof bulkPaySchema>
export type BulkCancelInput = z.infer<typeof bulkCancelSchema>
export type PayInstallmentInput = z.infer<typeof payInstallmentSchema>
export type FinancialFilterInput = z.infer<typeof financialFilterSchema>
export type RevenueFilterInput = z.infer<typeof revenueFilterSchema>
export type LedgerFilterInput = z.infer<typeof ledgerFilterSchema>

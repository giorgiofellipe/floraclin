import { z } from 'zod'
import type { PaymentMethod, FinancialStatus } from '@/types'

const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
const financialStatuses: FinancialStatus[] = ['pending', 'partial', 'paid', 'overdue', 'cancelled']

export const createFinancialEntrySchema = z.object({
  patientId: z.string().uuid('Paciente inválido'),
  procedureRecordId: z.string().uuid('Procedimento inválido').optional(),
  appointmentId: z.string().uuid('Agendamento inválido').optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(12, 'Máximo 12 parcelas'),
  notes: z.string().optional(),
})

export const payInstallmentSchema = z.object({
  installmentId: z.string().uuid('Parcela inválida'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
})

export const financialFilterSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(financialStatuses as [string, ...string[]]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const revenueFilterSchema = z.object({
  dateFrom: z.string().min(1, 'Data inicial é obrigatória'),
  dateTo: z.string().min(1, 'Data final é obrigatória'),
  practitionerId: z.string().uuid().optional(),
})

export type CreateFinancialEntryInput = z.infer<typeof createFinancialEntrySchema>
export type PayInstallmentInput = z.infer<typeof payInstallmentSchema>
export type FinancialFilterInput = z.infer<typeof financialFilterSchema>
export type RevenueFilterInput = z.infer<typeof revenueFilterSchema>

import { z } from 'zod'
import type { PaymentMethod } from '@/types'
import { brToday, endOfBrDay } from '@/lib/dates'
import { isCardMethod } from '@/lib/financial/card-repasses'

export const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
const financialStatuses = ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'renegotiated'] as const

// A payment date is a BR calendar day, so the ceiling is the end of today in
// BR, not `Date.now()`. The UI anchors a picked day to BR noon, which is ahead
// of the wall clock every morning.
export const paidAtField = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() <= endOfBrDay(brToday()).getTime(), {
    message: 'Data do pagamento não pode ser no futuro',
  })
  .optional()

const cardMatchesMethod = (data: { paymentMethod?: string; card?: unknown }) =>
  isCardMethod(data.paymentMethod) === (data.card !== undefined)

export const cardPaymentField = z
  .object({
    terminalId: z.string().uuid('Maquininha inválida'),
    installmentCount: z.number().int().min(1).max(12),
    expectedRate: z
      .number()
      .min(0)
      .max(100)
      .refine(hasAtMostTwoDecimals, 'Taxa deve ter no máximo duas casas decimais'),
  })
  .optional()

// payment_records.amount is decimal(10,2). Anything larger fails inside the
// transaction as a numeric overflow, which is a 500 for what is a bad input.
export const MAX_PAYMENT_AMOUNT = 99_999_999.99

// Allocation rounds to cents and the columns are decimal(10,2). A fractional
// cent would allocate one figure and store another.
function hasAtMostTwoDecimals(value: number): boolean {
  return Number(value.toFixed(2)) === value
}

export const createFinancialEntrySchema = z.object({
  patientId: z.string().uuid('Paciente inválido'),
  procedureRecordId: z.string().uuid('Procedimento inválido').optional(),
  appointmentId: z.string().uuid('Agendamento inválido').optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  totalAmount: z
    .number()
    .positive('Valor deve ser positivo')
    .max(MAX_PAYMENT_AMOUNT, 'Valor acima do limite permitido')
    .refine(hasAtMostTwoDecimals, 'Valor deve ter no máximo duas casas decimais'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(12, 'Máximo 12 parcelas'),
  customDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')).optional(),
  notes: z.string().optional(),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }).optional(),
  card: cardPaymentField,
})
  .refine(cardMatchesMethod, { message: 'Selecione a maquininha', path: ['card'] })
  .refine((data) => data.card === undefined || data.installmentCount === 1, {
    message: 'Pagamento em cartão gera uma única parcela',
    path: ['installmentCount'],
  })

export const recordPaymentSchema = z.object({
  installmentId: z.string().uuid('Parcela inválida'),
  amount: z
    .number()
    .min(0.01, 'Valor mínimo é R$ 0,01')
    .max(MAX_PAYMENT_AMOUNT, 'Valor acima do limite permitido')
    .refine(hasAtMostTwoDecimals, 'Valor deve ter no máximo duas casas decimais'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
  paidAt: paidAtField, // ISO string, defaults to now
  notes: z.string().optional(),
  // The total the dialog prefilled from. The write is refused when the
  // balance priced behind the lock no longer matches it, so a client that
  // does not send it cannot pay against a balance it never saw.
  expectedTotalDue: z
    .number({ message: 'Total pendente é obrigatório' })
    .min(0)
    .refine(hasAtMostTwoDecimals, 'Valor deve ter no máximo duas casas decimais'),
  acceptOverpayment: z.boolean().optional(),
  card: cardPaymentField,
}).refine(cardMatchesMethod, { message: 'Selecione a maquininha', path: ['card'] })

export const renegotiateSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  newInstallmentCount: z.number().int().min(1).max(24),
  newTotalAmount: z
    .number()
    .positive()
    .refine(hasAtMostTwoDecimals, 'Valor deve ter no máximo duas casas decimais')
    .optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  waivePenalties: z.boolean().optional().default(false),
  waiveAmount: z
    .number()
    .min(0)
    .refine(hasAtMostTwoDecimals, 'Valor deve ter no máximo duas casas decimais')
    .optional()
    .default(0),
  customDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')).optional(),
})

export const bulkPaySchema = z.object({
  installmentIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma parcela'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
  paidAt: paidAtField,
  card: cardPaymentField,
}).refine(cardMatchesMethod, { message: 'Selecione a maquininha', path: ['card'] })

export const bulkCancelSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  reason: z.string().min(1, 'Motivo é obrigatório'),
})

export const bulkUncancelSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  reason: z.string().min(1, 'Motivo é obrigatório'),
})

export const financialFilterSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(financialStatuses as unknown as [string, ...string[]]).optional(),
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
export type BulkUncancelInput = z.infer<typeof bulkUncancelSchema>
export type FinancialFilterInput = z.infer<typeof financialFilterSchema>
export type RevenueFilterInput = z.infer<typeof revenueFilterSchema>
export type LedgerFilterInput = z.infer<typeof ledgerFilterSchema>

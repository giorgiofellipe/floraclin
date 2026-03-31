import { z } from 'zod'
import type { PaymentMethod } from '@/types'

const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid('Categoria inválida'),
  description: z.string().min(1, 'Descrição é obrigatória'),
  totalAmount: z.number().positive('Valor deve ser positivo'),
  installmentCount: z.number().int().min(1, 'Mínimo 1 parcela').max(24, 'Máximo 24 parcelas'),
  notes: z.string().optional(),
  customDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (esperado YYYY-MM-DD)')).optional(), // ISO date strings, one per installment
})

export const payExpenseInstallmentSchema = z.object({
  installmentId: z.string().uuid('Parcela inválida'),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]], {
    message: 'Método de pagamento inválido',
  }),
  paidAt: z.string().datetime({ offset: true }).optional(),
})

export const expenseFilterSchema = z.object({
  status: z.enum(['pending', 'paid', 'cancelled'] as [string, ...string[]]).optional(),
  categoryId: z.string().uuid().optional(),
  isOverdue: z.boolean().optional(),
  paymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
})

export const expenseCategorySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100),
  icon: z.string().min(1).max(50).default('circle'),
})

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type PayExpenseInstallmentInput = z.infer<typeof payExpenseInstallmentSchema>
export type ExpenseFilterInput = z.infer<typeof expenseFilterSchema>
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>

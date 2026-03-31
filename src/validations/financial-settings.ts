import { z } from 'zod'
import type { PaymentMethod } from '@/types'

// FineType and PixKeyType may not exist in types yet (Track A runs in parallel)
const fineTypes = ['percentage', 'fixed'] as const
const pixKeyTypes = ['cpf', 'cnpj', 'email', 'phone', 'random'] as const
const paymentMethods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']

export const updateFinancialSettingsSchema = z.object({
  fineType: z.enum(fineTypes as [string, ...string[]]).optional(),
  fineValue: z.number().min(0).max(2, 'Multa não pode exceder 2%').optional(),
  monthlyInterestPercent: z.number().min(0).max(1, 'Juros não pode exceder 1% ao mês').optional(),
  gracePeriodDays: z.number().int().min(0).max(30).optional(),
  bankName: z.string().max(100).optional().nullable(),
  bankAgency: z.string().max(20).optional().nullable(),
  bankAccount: z.string().max(30).optional().nullable(),
  pixKeyType: z.enum(pixKeyTypes as [string, ...string[]]).optional().nullable(),
  pixKey: z.string().max(100).optional().nullable(),
  defaultInstallmentCount: z.number().int().min(1).max(12).optional(),
  defaultPaymentMethod: z.enum(paymentMethods as [string, ...string[]]).optional().nullable(),
})

export type UpdateFinancialSettingsInput = z.infer<typeof updateFinancialSettingsSchema>

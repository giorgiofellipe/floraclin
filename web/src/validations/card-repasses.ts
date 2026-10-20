import { z } from 'zod'
import { isValidYmd } from '@/lib/dates'
import { MAX_PAYMENT_AMOUNT } from '@/validations/financial'

const ymd = z.string().refine(isValidYmd, 'Data inválida')

export const adjustRepasseSchema = z.object({
  netAmount: z.number().positive('Valor inválido').max(MAX_PAYMENT_AMOUNT, 'Valor inválido'),
  expectedDate: ymd,
})

export const listRepassesQuerySchema = z.object({
  dateFrom: ymd,
  dateTo: ymd,
  terminalId: z.string().uuid().optional(),
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

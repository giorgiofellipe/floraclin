import { z } from 'zod'
import { isValidYmd } from '@/lib/dates'

const ymd = z.string().refine(isValidYmd, 'Data inválida')

export const adjustRepasseSchema = z.object({
  netAmount: z.number().positive('Valor inválido').max(9_999_999.99, 'Valor inválido'),
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

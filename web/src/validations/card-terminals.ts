import { z } from 'zod'

const percent = z
  .number()
  .min(0, 'Taxa inválida')
  .max(100, 'Taxa inválida')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais')

const payoutDays = z.number().int().min(0, 'Prazo inválido').max(60, 'Prazo inválido')

export const cardTerminalSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo'),
  isDefault: z.boolean(),
  debitRate: percent,
  debitPayoutDays: payoutDays,
  creditRates: z.array(percent).length(12, 'Informe a taxa de 1x a 12x'),
  creditPayoutMode: z.enum(['per_installment', 'lump_sum']),
  creditLumpSumDays: payoutDays,
})

export type CardTerminalInput = z.infer<typeof cardTerminalSchema>

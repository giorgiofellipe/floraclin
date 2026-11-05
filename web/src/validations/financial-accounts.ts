import { z } from 'zod'
import { brToday, isValidYmd } from '@/lib/dates'

// isValidYmd also refuses days that don't exist, like 2026-02-31, which would
// parse to an Invalid Date.
const ymd = z.string().refine(isValidYmd, 'Data inválida (esperado YYYY-MM-DD)')

const cents = (v: number) => Number(v.toFixed(2)) === v

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Texto muito longo')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

const accountFields = {
  name: z.string().trim().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo'),
  bankName: optionalText(100),
  bankAgency: optionalText(20),
  bankAccount: optionalText(30),
  isDefault: z.boolean(),
  // numeric(12,2)
  openingBalance: z
    .number()
    .min(-9_999_999_999.99, 'Valor fora do limite')
    .max(9_999_999_999.99, 'Valor fora do limite')
    .refine(cents, 'Use no máximo 2 casas decimais'),
  openingBalanceDate: ymd.optional().nullable(),
}

const openingNeedsDate = (data: { openingBalance: number; openingBalanceDate?: string | null }) =>
  data.openingBalance === 0 || Boolean(data.openingBalanceDate)

const openingDateMessage = { message: 'Informe a data do saldo inicial', path: ['openingBalanceDate'] }

export const createFinancialAccountSchema = z
  .object({ kind: z.enum(['bank', 'cash', 'acquirer']), ...accountFields })
  .refine(openingNeedsDate, openingDateMessage)
  .refine((data) => !data.isDefault || data.kind !== 'acquirer', {
    message: 'Conta de adquirente não pode ser padrão',
    path: ['isDefault'],
  })

// The kind is fixed at creation: it decides which default an account can be.
export const updateFinancialAccountSchema = z.object(accountFields).refine(openingNeedsDate, openingDateMessage)

export const archiveFinancialAccountSchema = z.object({ archived: z.boolean() })

export const transferSchema = z.object({
  fromAccountId: z.string().uuid('Conta de origem inválida'),
  toAccountId: z.string().uuid('Conta de destino inválida'),
  // cash_movements.amount is numeric(10,2)
  amount: z
    .number()
    .min(0.01, 'Valor mínimo é R$ 0,01')
    .max(99_999_999.99, 'Valor acima do limite permitido')
    .refine(cents, 'Use no máximo 2 casas decimais'),
  date: ymd.refine((v) => v <= brToday(), 'A data não pode ser no futuro'),
  description: z.string().trim().max(255, 'Descrição muito longa').optional(),
})

/** An optional account picked in a payment dialog; omitted means the default. */
export const accountIdField = z.string().uuid('Conta inválida').optional()

export type CreateFinancialAccountInput = z.infer<typeof createFinancialAccountSchema>
export type UpdateFinancialAccountInput = z.infer<typeof updateFinancialAccountSchema>
export type TransferInput = z.infer<typeof transferSchema>

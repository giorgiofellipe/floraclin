import { z } from 'zod'

export const statementLineFilterSchema = z.object({
  accountId: z.string().uuid('Conta inválida'),
  status: z.enum(['pending', 'open', 'partial', 'matched', 'ignored', 'all']).default('pending'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

export const allocateSchema = z.object({
  allocations: z
    .array(
      z.object({
        movementId: z.string().uuid('Movimentação inválida'),
        // Whole cents: the ledger is numeric(10,2) and the statement is exact.
        amountCents: z.number().int().min(1, 'Valor mínimo é R$ 0,01').max(99_999_999_99, 'Valor acima do limite'),
      }),
    )
    .min(1, 'Escolha ao menos uma movimentação')
    .max(50, 'No máximo 50 movimentações por conciliação'),
})

export const undoMatchSchema = z.object({
  allocationId: z.string().uuid('Conciliação inválida').optional(),
})

export const ignoreLineSchema = z.object({
  reason: z.string().trim().min(1, 'Informe o motivo').max(255, 'Motivo muito longo'),
})

export const candidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  includeBookkeepingPairs: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})

export const expenseFromLineSchema = z.object({
  categoryId: z.string().uuid('Categoria inválida'),
  description: z.string().trim().max(255, 'Descrição muito longa').optional(),
  paymentMethod: z.enum(['pix', 'transfer', 'debit_card', 'cash', 'credit_card']).default('transfer'),
})

export const importFormSchema = z.object({
  accountId: z.string().uuid('Conta inválida'),
})

export type AllocateInput = z.infer<typeof allocateSchema>

import { describe, it, expect } from 'vitest'
import { createFinancialAccountSchema, moveMovementsSchema, transferSchema } from '../financial-accounts'

const FROM = '550e8400-e29b-41d4-a716-446655440000'
const TO = '550e8400-e29b-41d4-a716-446655440001'
const MOVEMENT = '550e8400-e29b-41d4-a716-446655440002'

describe('moveMovementsSchema', () => {
  it('accepts picked movements', () => {
    expect(moveMovementsSchema.safeParse({ toAccountId: TO, movementIds: [MOVEMENT] }).success).toBe(true)
  })

  it('accepts a whole account with an optional period', () => {
    expect(moveMovementsSchema.safeParse({ toAccountId: TO, fromAccountId: FROM }).success).toBe(true)
    expect(
      moveMovementsSchema.safeParse({ toAccountId: TO, fromAccountId: FROM, dateFrom: '2026-10-01', dateTo: '2026-10-31' }).success,
    ).toBe(true)
  })

  it.each([
    ['neither movements nor a source account', { toAccountId: TO }],
    ['both movements and a source account', { toAccountId: TO, movementIds: [MOVEMENT], fromAccountId: FROM }],
    ['the same source and destination', { toAccountId: TO, fromAccountId: TO }],
    ['a period with picked movements', { toAccountId: TO, movementIds: [MOVEMENT], dateFrom: '2026-10-01' }],
    ['a reversed period', { toAccountId: TO, fromAccountId: FROM, dateFrom: '2026-11-01', dateTo: '2026-10-01' }],
    ['a day that does not exist', { toAccountId: TO, fromAccountId: FROM, dateFrom: '2026-02-31' }],
    ['an empty list', { toAccountId: TO, movementIds: [] }],
  ])('refuses %s', (_name, input) => {
    expect(moveMovementsSchema.safeParse(input).success).toBe(false)
  })
})

describe('account dates', () => {
  // 2026-02-31 would reach parseBrDate and become an Invalid Date.
  it.each(['2026-02-31', '2026-13-01', '2026-11-1'])('refuses %s as a transfer date', (date) => {
    expect(transferSchema.safeParse({ fromAccountId: FROM, toAccountId: TO, amount: 1, date }).success).toBe(false)
  })

  it('accepts a real past day as a transfer date', () => {
    expect(transferSchema.safeParse({ fromAccountId: FROM, toAccountId: TO, amount: 1, date: '2024-02-29' }).success).toBe(true)
  })

  it('refuses a day that does not exist as an opening balance date', () => {
    const result = createFinancialAccountSchema.safeParse({
      kind: 'bank',
      name: 'Itaú',
      isDefault: false,
      openingBalance: 100,
      openingBalanceDate: '2026-02-30',
    })
    expect(result.success).toBe(false)
  })
})

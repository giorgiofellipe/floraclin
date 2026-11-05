import { describe, it, expect } from 'vitest'
import { createFinancialAccountSchema, transferSchema } from '../financial-accounts'

const FROM = '550e8400-e29b-41d4-a716-446655440000'
const TO = '550e8400-e29b-41d4-a716-446655440001'

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

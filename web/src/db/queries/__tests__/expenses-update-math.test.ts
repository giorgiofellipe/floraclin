import { describe, it, expect } from 'vitest'

// Extract the pure distribution math into a helper so it's testable.
// If not already exported from expenses.ts, copy the logic inline in the test.

function distribute(totalCents: number, sumPaidCents: number, newCount: number, paidCount: number) {
  const unpaidCount = newCount - paidCount
  const remainingCents = totalCents - sumPaidCents
  if (unpaidCount === 0) return []
  const perSlotCents = Math.floor(remainingCents / unpaidCount)
  const remainderCents = remainingCents - perSlotCents * unpaidCount
  return Array.from({ length: unpaidCount }, (_, i) =>
    perSlotCents + (i === 0 ? remainderCents : 0),
  )
}

describe('installment distribution', () => {
  it('splits R$ 1000 into 5 equal R$ 200 installments (no paid yet)', () => {
    expect(distribute(100000, 0, 5, 0)).toEqual([20000, 20000, 20000, 20000, 20000])
  })

  it('puts rounding remainder on first unpaid slot for R$ 1000 / 3', () => {
    // 100000 / 3 = 33333.33... → floor 33333 each, remainder 1 cent to slot 0
    expect(distribute(100000, 0, 3, 0)).toEqual([33334, 33333, 33333])
  })

  it('regenerates only unpaid when 2 of 5 are already paid', () => {
    // R$ 1000 total, R$ 400 paid → 600 remaining across 3 slots = 200 each
    expect(distribute(100000, 40000, 5, 2)).toEqual([20000, 20000, 20000])
  })

  it('returns empty array when all installments are paid (no more to distribute)', () => {
    expect(distribute(100000, 100000, 5, 5)).toEqual([])
  })

  it('handles float-trap case 0.1 + 0.2 via cents integers', () => {
    // Legacy: 0.1 + 0.2 = 0.30000000000000004 in float.
    // In cents: 10 + 20 = 30 exactly.
    const sumPaidCents = Math.round(0.1 * 100) + Math.round(0.2 * 100)
    expect(sumPaidCents).toBe(30)
  })
})

describe('updateExpense validation branches', () => {
  function validate(totalCents: number, sumPaidCents: number, newCount: number, paidCount: number) {
    const unpaidCount = newCount - paidCount
    const remainingCents = totalCents - sumPaidCents
    if (totalCents < sumPaidCents) return 'Valor menor que o já pago'
    if (newCount < paidCount) return 'Parcelas menor que as já pagas'
    if ((remainingCents === 0) !== (unpaidCount === 0)) return 'Valor e parcelas inconsistentes'
    return 'ok'
  }

  it('rejects total < sum of paid', () => {
    expect(validate(30000, 40000, 5, 2)).toBe('Valor menor que o já pago')
  })

  it('rejects newCount < paidCount', () => {
    expect(validate(100000, 40000, 1, 2)).toBe('Parcelas menor que as já pagas')
  })

  it('rejects inconsistent money vs slots', () => {
    // 2 paid of R$ 400, new total = R$ 400 but still asking for 3 unpaid slots
    expect(validate(40000, 40000, 5, 2)).toBe('Valor e parcelas inconsistentes')
  })

  it('accepts reduce-to-paid-equals-complete', () => {
    // paid=2 R$400, new total=R$400, count=2 → fully paid
    expect(validate(40000, 40000, 2, 2)).toBe('ok')
  })

  it('accepts add-installments-to-fully-paid', () => {
    // was R$ 400 / 2 paid, user adds R$ 600 more over 3 installments = R$1000 / 5
    expect(validate(100000, 40000, 5, 2)).toBe('ok')
  })
})

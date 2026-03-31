import { describe, it, expect } from 'vitest'
import {
  calculateFine,
  calculateInterest,
  allocatePayment,
  replayPayments,
  getDaysOverdue,
} from '../penalties'

describe('calculateFine', () => {
  it('calculates percentage fine correctly', () => {
    expect(calculateFine(1000, 'percentage', 2)).toBe(20)
  })

  it('caps percentage fine at 2%', () => {
    expect(calculateFine(1000, 'percentage', 5)).toBe(20) // 2% cap
  })

  it('calculates fixed fine correctly', () => {
    expect(calculateFine(1000, 'fixed', 15)).toBe(15)
  })

  it('caps fixed fine at 2% of amount', () => {
    expect(calculateFine(1000, 'fixed', 50)).toBe(20) // 2% = 20
  })

  it('returns 0 when fine value is 0', () => {
    expect(calculateFine(1000, 'percentage', 0)).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    expect(calculateFine(333.33, 'percentage', 2)).toBe(6.67)
  })
})

describe('calculateInterest', () => {
  it('calculates 1% monthly interest for 30 days', () => {
    expect(calculateInterest(1000, 30, 1)).toBe(10)
  })

  it('calculates pro-rata daily interest', () => {
    expect(calculateInterest(1000, 15, 1)).toBe(5) // half month
  })

  it('caps interest at 1% per month', () => {
    expect(calculateInterest(1000, 30, 2)).toBe(10) // capped at 1%
  })

  it('returns 0 for 0 days overdue', () => {
    expect(calculateInterest(1000, 0, 1)).toBe(0)
  })

  it('returns 0 for 0 remaining principal', () => {
    expect(calculateInterest(0, 30, 1)).toBe(0)
  })

  it('returns 0 for negative days', () => {
    expect(calculateInterest(1000, -5, 1)).toBe(0)
  })

  it('handles 90 days overdue correctly', () => {
    expect(calculateInterest(1000, 90, 1)).toBe(30) // 3 months
  })

  it('rounds to 2 decimal places', () => {
    expect(calculateInterest(333.33, 7, 1)).toBe(0.78)
  })
})

describe('getDaysOverdue', () => {
  it('returns 0 when not yet due', () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    expect(getDaysOverdue(future.toISOString(), 0)).toBe(0)
  })

  it('respects grace period', () => {
    const past = new Date()
    past.setDate(past.getDate() - 2)
    expect(getDaysOverdue(past.toISOString(), 3)).toBe(0) // within grace
    expect(getDaysOverdue(past.toISOString(), 1)).toBe(1) // 2 days - 1 grace = 1
  })

  it('counts days after grace period', () => {
    const past = new Date()
    past.setDate(past.getDate() - 35)
    expect(getDaysOverdue(past.toISOString(), 5)).toBe(30)
  })
})

describe('allocatePayment (Art. 354)', () => {
  it('allocates to interest first', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 10)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(0)
  })

  it('allocates to fine after interest', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 25)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(15)
    expect(result.principalCovered).toBe(0)
  })

  it('allocates to principal after interest and fine', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 530)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(20)
    expect(result.principalCovered).toBe(500)
  })

  it('handles full payoff', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 1030)
    expect(result.interestCovered).toBe(10)
    expect(result.fineCovered).toBe(20)
    expect(result.principalCovered).toBe(1000)
  })

  it('handles overpayment - caps at total due', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 10,
    }, 2000)
    expect(result.principalCovered).toBe(1000)
    expect(result.interestCovered + result.fineCovered + result.principalCovered).toBe(1030)
  })

  it('handles partially paid principal', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 500, fineAmount: 5, interestAmount: 3,
    }, 508)
    expect(result.interestCovered).toBe(3)
    expect(result.fineCovered).toBe(5)
    expect(result.principalCovered).toBe(500)
  })

  it('handles payment less than interest', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 20, interestAmount: 50,
    }, 30)
    expect(result.interestCovered).toBe(30)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(0)
  })

  it('handles no penalties (non-overdue installment)', () => {
    const result = allocatePayment({
      amount: 1000, amountPaid: 0, fineAmount: 0, interestAmount: 0,
    }, 1000)
    expect(result.interestCovered).toBe(0)
    expect(result.fineCovered).toBe(0)
    expect(result.principalCovered).toBe(1000)
  })
})

describe('replayPayments', () => {
  it('replays single payment correctly', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [{ amount: 500, paidAt: '2026-02-01T00:00:00Z' }], // 31 days overdue
    )
    expect(result.payments.length).toBe(1)
    expect(result.payments[0].interestCovered).toBeGreaterThan(0)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('replays two payments in chronological order', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 200, paidAt: '2026-02-01T00:00:00Z' },
        { amount: 300, paidAt: '2026-03-01T00:00:00Z' },
      ],
    )
    expect(result.payments.length).toBe(2)
    // Second payment should have less interest (lower remaining principal)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('handles backdated payment insertion correctly', () => {
    // Payment 1 recorded March 1, payment 2 backdated to Feb 1
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 200, paidAt: '2026-02-01T00:00:00Z' }, // backdated
        { amount: 300, paidAt: '2026-03-01T00:00:00Z' }, // original
      ],
    )
    // After replay, both allocations should be correct for their respective dates
    expect(result.payments[0].paidAt).toBe('2026-02-01T00:00:00Z')
    expect(result.payments[1].paidAt).toBe('2026-03-01T00:00:00Z')
  })

  it('applies fine when installment becomes overdue after on-time partial payment', () => {
    // First payment is on-time (before due date), second payment is overdue
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-03-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 200, paidAt: '2026-02-15T00:00:00Z' }, // before due date — no fine
        { amount: 300, paidAt: '2026-04-01T00:00:00Z' }, // 31 days after due — should apply fine
      ],
    )
    // First payment: no penalties (not overdue yet)
    expect(result.payments[0].fineCovered).toBe(0)
    expect(result.payments[0].interestCovered).toBe(0)
    // Second payment: fine should be applied (R$20 = 2% of 1000)
    // The fine + interest should be covered before principal
    const totalFineCovered = result.payments.reduce((sum, p) => sum + p.fineCovered, 0)
    expect(totalFineCovered).toBeGreaterThan(0)
    expect(totalFineCovered).toBeLessThanOrEqual(20)
  })

  it('applies fine only once even with multiple payments', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        { amount: 100, paidAt: '2026-02-01T00:00:00Z' },
        { amount: 100, paidAt: '2026-03-01T00:00:00Z' },
        { amount: 100, paidAt: '2026-04-01T00:00:00Z' },
      ],
    )
    // Total fine covered across all payments should not exceed the original fine (20)
    const totalFineCovered = result.payments.reduce((sum, p) => sum + p.fineCovered, 0)
    expect(totalFineCovered).toBeLessThanOrEqual(20)
  })
})

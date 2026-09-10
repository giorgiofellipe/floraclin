import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateFine,
  calculateInterest,
  allocatePayment,
  replayPayments,
  quoteInstallment,
  type PaymentInput,
} from '../penalties'

// recordedAt defaults to paidAt so pre-existing test literals stay short;
// pass a fourth argument where recordedAt must differ from paidAt.
function pay(
  id: string,
  amount: number,
  paidAt: string,
  recordedAt: string = paidAt,
): PaymentInput {
  return { id, amount, paidAt, recordedAt }
}

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
      // Feb 1 00:00Z is Jan 31 in BR — 30 days after the Jan 1 due date.
      [pay('p1', 500, '2026-02-01T00:00:00Z')],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(result.payments.length).toBe(1)
    expect(result.payments[0].interestCovered).toBeGreaterThan(0)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('replays two payments in chronological order', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0 },
      [
        pay('p1', 200, '2026-02-01T00:00:00Z'),
        pay('p2', 300, '2026-03-01T00:00:00Z'),
      ],
      new Date('2026-09-03T14:04:50.000Z'),
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
        pay('p1', 200, '2026-02-01T00:00:00Z'), // backdated
        pay('p2', 300, '2026-03-01T00:00:00Z'), // original
      ],
      new Date('2026-09-03T14:04:50.000Z'),
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
        pay('p1', 200, '2026-02-15T00:00:00Z'), // before due date — no fine
        pay('p2', 300, '2026-04-01T00:00:00Z'), // 31 days after due — should apply fine
      ],
      new Date('2026-09-03T14:04:50.000Z'),
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
        pay('p1', 100, '2026-02-01T00:00:00Z'),
        pay('p2', 100, '2026-03-01T00:00:00Z'),
        pay('p3', 100, '2026-04-01T00:00:00Z'),
      ],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    // Total fine covered across all payments should not exceed the original fine (20)
    const totalFineCovered = result.payments.reduce((sum, p) => sum + p.fineCovered, 0)
    expect(totalFineCovered).toBeLessThanOrEqual(20)
  })
})

const BASE = {
  amount: 750,
  dueDate: '2026-05-22',
  appliedFineValue: 2,
  appliedFineType: 'percentage',
  appliedInterestRate: 1,
  gracePeriodDays: 0,
}

describe('quoteInstallment', () => {
  it('prices an unpaid overdue installment as of now', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.remainingPrincipal).toBe(750)
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(26)
    expect(q.totalDue).toBe(791)
  })

  it('prices one day cheaper for an instant that is still the previous BR calendar day', () => {
    // 2026-09-03T00:00:00Z is 21:00 BRT on Sep 2, a different BR calendar
    // day than 2026-09-03T14:04:50Z (Sep 3 BRT) used above.
    const q = quoteInstallment(BASE, [], new Date('2026-09-03T00:00:00.000Z'))
    expect(q.interestAmount).toBe(25.75)
    expect(q.totalDue).toBe(790.75)
  })

  it('charges nothing extra before the due date', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-05-01T12:00:00.000Z'))
    expect(q.fineAmount).toBe(0)
    expect(q.interestAmount).toBe(0)
    expect(q.totalDue).toBe(750)
  })

  it('honours the grace period', () => {
    const q = quoteInstallment(
      { ...BASE, gracePeriodDays: 5 },
      [],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(q.interestAmount).toBe(24.75)
  })

  // AR-1: the headline backdating case. A later payment already exists; the
  // quote must price the earlier date, not the state after that later payment.
  it('ignores payments dated after the quote instant', () => {
    const later = pay('p2', 500, '2026-08-01T12:00:00.000Z')
    const q = quoteInstallment(BASE, [later], new Date('2026-06-22T12:00:00.000Z'))
    expect(q.remainingPrincipal).toBe(750)
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(7.75)
    expect(q.totalDue).toBe(772.75)
  })

  it('agrees with replayPayments inserting the same payment chronologically', () => {
    const later = pay('p2', 500, '2026-08-01T12:00:00.000Z')
    const asOf = new Date('2026-06-22T12:00:00.000Z')
    const q = quoteInstallment(BASE, [later], asOf)
    const replayed = replayPayments(
      BASE,
      [later, pay('new', q.totalDue, asOf.toISOString())],
      asOf,
    )
    const inserted = replayed.payments.find((p) => p.id === 'new')!
    expect(inserted.excessAmount).toBe(0)
    const covered =
      inserted.interestCovered + inserted.fineCovered + inserted.principalCovered
    expect(Math.round(covered * 100) / 100).toBe(q.totalDue)
  })

  it('does not charge the fine twice when an earlier payment took it', () => {
    const first = pay('p1', 100, '2026-06-22T12:00:00.000Z')
    expect(quoteInstallment(BASE, [first], new Date('2026-07-22T12:00:00.000Z')).fineAmount).toBe(0)
  })

  it('charges the fine when every earlier payment was on time', () => {
    const onTime = pay('p1', 100, '2026-05-01T12:00:00.000Z')
    expect(
      quoteInstallment(BASE, [onTime], new Date('2026-09-03T14:04:50.000Z')).fineAmount,
    ).toBe(15)
  })

  it('quotes zero once everything is settled', () => {
    const settled = pay('p1', 791, '2026-09-03T14:04:50.000Z')
    const q = quoteInstallment(BASE, [settled], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.totalDue).toBe(0)
  })
})

describe('replayPayments interest origin', () => {
  // AR-6: an on-time payment must not start the interest clock early.
  it('starts interest at the due date, not at an earlier on-time payment', () => {
    const onTime = pay('p1', 10, '2026-05-01T12:00:00.000Z')
    const q = quoteInstallment(BASE, [onTime], new Date('2026-09-03T14:04:50.000Z'))
    // 104 days from 2026-05-22, on a principal of 740, not 125 days from 2026-05-01.
    expect(q.interestAmount).toBe(25.65)
  })

  it('keeps the grace period after an on-time payment', () => {
    const onTime = pay('p1', 10, '2026-05-01T12:00:00.000Z')
    const q = quoteInstallment(
      { ...BASE, gracePeriodDays: 5 },
      [onTime],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(q.interestAmount).toBe(24.42)
  })
})

describe('replayPayments carried interest', () => {
  // AR-2: interest a payment does not cover stays owed.
  it('carries interest a payment could not cover', () => {
    const tiny = pay('p1', 1, '2026-09-03T14:04:50.000Z')
    const result = replayPayments(BASE, [tiny], new Date('2026-09-03T14:04:50.000Z'))
    expect(result.installmentState.carriedInterest).toBe(25)
    expect(result.installmentState.amountPaid).toBe(0)
    // 25 carried, plus zero elapsed since the payment instant.
    expect(result.installmentState.interestAmount).toBe(25)
  })

  it('a later payment must still cover the carried interest', () => {
    const tiny = pay('p1', 1, '2026-09-03T14:04:50.000Z')
    const q = quoteInstallment(BASE, [tiny], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.interestAmount).toBe(25)
    expect(q.fineAmount).toBe(15)
    expect(q.totalDue).toBe(790)
  })

  it('carries nothing when the payment covers all interest', () => {
    const big = pay('p1', 100, '2026-09-03T14:04:50.000Z')
    expect(
      replayPayments(BASE, [big], new Date('2026-09-03T14:04:50.000Z')).installmentState
        .carriedInterest,
    ).toBe(0)
  })
})

describe('replayPayments ordering', () => {
  // AR-medium: BR-noon anchoring makes same-instant payments common.
  it('orders equal timestamps stably by id', () => {
    const a = pay('aaa', 30, '2026-09-03T15:00:00.000Z')
    const b = pay('bbb', 30, '2026-09-03T15:00:00.000Z')
    const asOf = new Date('2026-09-03T14:04:50.000Z')
    const forward = replayPayments(BASE, [a, b], asOf)
    const backward = replayPayments(BASE, [b, a], asOf)
    expect(forward.payments.map((p) => p.id)).toEqual(['aaa', 'bbb'])
    expect(backward.payments.map((p) => p.id)).toEqual(['aaa', 'bbb'])
    expect(forward.installmentState).toEqual(backward.installmentState)
  })
})

describe('replayPayments fineApplied', () => {
  it('is false when no payment was overdue', () => {
    expect(
      replayPayments(
        BASE,
        [pay('p1', 100, '2026-05-01T12:00:00.000Z')],
        new Date('2026-09-03T14:04:50.000Z'),
      ).installmentState.fineApplied,
    ).toBe(false)
  })

  it('is true once an overdue payment took the fine', () => {
    expect(
      replayPayments(
        BASE,
        [pay('p1', 100, '2026-06-22T12:00:00.000Z')],
        new Date('2026-09-03T14:04:50.000Z'),
      ).installmentState.fineApplied,
    ).toBe(true)
  })

  it('is false with no payments', () => {
    expect(
      replayPayments(BASE, [], new Date('2026-09-03T14:04:50.000Z')).installmentState.fineApplied,
    ).toBe(false)
  })
})

describe('replayPayments asOf', () => {
  // The wall clock is frozen on a different day so this fails against an
  // implementation that ignores asOf and reads new Date().
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T14:04:50.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('prices the trailing interest at asOf, not at the wall clock', () => {
    const tiny = pay('p1', 1, '2026-09-03T14:04:50.000Z')
    const later = replayPayments(BASE, [tiny], new Date('2026-09-13T14:04:50.000Z'))
    // 25 carried plus ten more days on 750 at 1%/month.
    expect(later.installmentState.interestAmount).toBe(27.5)
  })
})

describe('fine gate on the absolute due date', () => {
  // Two payments under 24h apart used to floor to zero days each and dodge
  // the fine entirely. Calendar-day arithmetic fixes the count; the gate on
  // the absolute due date fixes the trigger.
  it('charges the fine on a payment the day after the due date even if a payment landed on the due date', () => {
    const onDueDay = pay('p1', 100, '2026-05-22T15:00:00.000Z') // 12:00 BRT May 22
    const q = quoteInstallment(BASE, [onDueDay], new Date('2026-05-23T13:00:00.000Z')) // 10:00 BRT May 23
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(0.22) // 650 * 1%/30 * 1 day
  })

  // The next two also pass against the pre-change code; they characterise the
  // boundary so the calendar-day rewrite cannot move it.
  it('does not charge the fine on the due date itself', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-05-22T23:00:00.000Z')) // 20:00 BRT May 22
    expect(q.fineAmount).toBe(0)
  })

  it('charges the fine the calendar day after grace ends', () => {
    const withGrace = { ...BASE, gracePeriodDays: 5 }
    expect(quoteInstallment(withGrace, [], new Date('2026-05-27T20:00:00.000Z')).fineAmount).toBe(0)
    expect(quoteInstallment(withGrace, [], new Date('2026-05-28T13:00:00.000Z')).fineAmount).toBe(15)
  })
})

describe('no fine on a settled balance', () => {
  it('quotes zero for an installment paid in full before the due date, months later', () => {
    const early = pay('p1', 750, '2026-05-01T15:00:00.000Z')
    const q = quoteInstallment(BASE, [early], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.remainingPrincipal).toBe(0)
    expect(q.fineAmount).toBe(0)
    expect(q.interestAmount).toBe(0)
    expect(q.totalDue).toBe(0)
  })
})

describe('tie-break on recordedAt', () => {
  it('orders equal paidAt by recordedAt, and the in-flight payment last', () => {
    const t = '2026-09-03T15:00:00.000Z'
    const older = pay('zzz', 30, t, '2026-09-03T15:00:01.000Z')
    const inFlight = pay('__new__', 30, t, '2026-09-03T15:00:09.000Z')
    const result = replayPayments(BASE, [inFlight, older], new Date(t))
    expect(result.payments.map((p) => p.id)).toEqual(['zzz', '__new__'])
    // The older payment takes the interest; the in-flight one hits the fine.
    expect(result.payments[0].interestCovered).toBe(26)
    expect(result.payments[1].interestCovered).toBe(0)
  })

  it('is stable when the in-flight id is replaced by a uuid on a later replay', () => {
    const t = '2026-09-03T15:00:00.000Z'
    const a = pay('zzz', 30, t, '2026-09-03T15:00:01.000Z')
    const b = pay('00000000-0000-4000-8000-000000000001', 30, t, '2026-09-03T15:00:09.000Z')
    const result = replayPayments(BASE, [b, a], new Date(t))
    expect(result.payments.map((p) => p.id)).toEqual(['zzz', b.id])
  })
})

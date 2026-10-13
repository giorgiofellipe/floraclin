import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateFine,
  calculateInterest,
  allocatePayment,
  replayPayments,
  quoteInstallment,
  type PaymentInput,
  type PenaltyPause,
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
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0, penaltyPauses: [] },
      // Feb 1 00:00Z is Jan 31 in BR, 30 days after the Jan 1 due date.
      [pay('p1', 500, '2026-02-01T00:00:00Z')],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(result.payments.length).toBe(1)
    expect(result.payments[0].interestCovered).toBeGreaterThan(0)
    expect(result.installmentState.amountPaid).toBeGreaterThan(0)
  })

  it('replays two payments in chronological order', () => {
    const result = replayPayments(
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0, penaltyPauses: [] },
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
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0, penaltyPauses: [] },
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
      { amount: 1000, dueDate: '2026-03-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0, penaltyPauses: [] },
      [
        pay('p1', 200, '2026-02-15T00:00:00Z'), // before due date, no fine
        pay('p2', 300, '2026-04-01T00:00:00Z'), // 31 days after due, so the fine applies
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
      { amount: 1000, dueDate: '2026-01-01', appliedFineValue: 2, appliedFineType: 'percentage', appliedInterestRate: 1, gracePeriodDays: 0, penaltyPauses: [] },
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
  penaltyPauses: [] as PenaltyPause[],
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

  // A later payment already exists; the
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
  // An on-time payment must not start the interest clock early.
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
  // Interest a payment does not cover stays owed.
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
  // BR-noon anchoring makes same-instant payments common.
  it('orders equal timestamps stably by id', () => {
    const a = pay('aaa', 30, '2026-09-03T15:00:00.000Z')
    const b = pay('bbb', 30, '2026-09-03T15:00:00.000Z')
    const asOf = new Date('2026-09-03T15:00:00.000Z')
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

  // The next two pin the boundary so the calendar-day arithmetic cannot move it.
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

// Cancel and uncancel instants at 12:00 BRT, so each one sits plainly inside
// its BR calendar day.
function pause(from: string, to: string | null): PenaltyPause {
  return {
    from: `${from}T15:00:00.000Z`,
    to: to === null ? null : `${to}T15:00:00.000Z`,
  }
}

describe('penalty pauses while cancelled', () => {
  it.each([
    {
      // 3 days before the cancel and 7 after the uncancel: 750 * 1%/30 * 10.
      name: 'interest counts only the days the installment was not cancelled',
      base: { ...BASE, penaltyPauses: [pause('2026-05-25', '2026-09-03')] },
      at: '2026-09-10T15:00:00.000Z',
      fine: 15,
      interest: 2.5,
    },
    {
      name: 'a pause still open stops interest at the cancel day',
      base: { ...BASE, penaltyPauses: [pause('2026-05-25', null)] },
      at: '2026-09-10T15:00:00.000Z',
      fine: 15,
      interest: 0.75,
    },
    {
      // Same figures as the unpaused quote at this instant.
      name: 'a pause entirely before the due date changes nothing',
      base: { ...BASE, penaltyPauses: [pause('2026-05-01', '2026-05-10')] },
      at: '2026-09-03T14:04:50.000Z',
      fine: 15,
      interest: 26,
    },
    {
      // 104 days to Sep 3, less 10 + 10 paused: 84 days.
      name: 'two pause cycles add up',
      base: {
        ...BASE,
        penaltyPauses: [pause('2026-05-25', '2026-06-04'), pause('2026-07-01', '2026-07-11')],
      },
      at: '2026-09-03T14:04:50.000Z',
      fine: 15,
      interest: 21,
    },
    {
      // May 25 to Jun 14 is 20 days once, not 10 + 13.
      name: 'overlapping pauses do not count the shared days twice',
      base: {
        ...BASE,
        penaltyPauses: [pause('2026-05-25', '2026-06-04'), pause('2026-06-01', '2026-06-14')],
      },
      at: '2026-09-03T14:04:50.000Z',
      fine: 15,
      interest: 21,
    },
    {
      // Paused May 22 to 30 eats the first eight days after the due date, so
      // the five days of grace run May 31 to Jun 4.
      name: 'a pause covering the grace window keeps the fine off through the delayed grace',
      base: { ...BASE, gracePeriodDays: 5, penaltyPauses: [pause('2026-05-21', '2026-05-30')] },
      at: '2026-06-04T15:00:00.000Z',
      fine: 0,
      interest: 0,
    },
    {
      name: 'a pause covering the grace window charges the fine the day after the delayed grace',
      base: { ...BASE, gracePeriodDays: 5, penaltyPauses: [pause('2026-05-21', '2026-05-30')] },
      at: '2026-06-05T15:00:00.000Z',
      fine: 15,
      interest: 0.25,
    },
  ])('$name', ({ base, at, fine, interest }) => {
    const q = quoteInstallment(base, [], new Date(at))
    expect([q.fineAmount, q.interestAmount]).toEqual([fine, interest])
  })

  it('a payment inside a later unpaused stretch accrues interest only for unpaused days', () => {
    const base = { ...BASE, penaltyPauses: [pause('2026-05-25', '2026-09-03')] }
    const result = replayPayments(base, [pay('p1', 100, '2026-09-10T15:00:00.000Z')], new Date('2026-09-10T15:00:00.000Z'))
    expect(result.payments[0].interestCovered).toBe(2.5)
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
    // The older payment takes all 26 of interest and 4 of the fine; the
    // in-flight one meets no interest and covers the remaining 11 of fine.
    expect(result.payments[0].interestCovered).toBe(26)
    expect(result.payments[0].fineCovered).toBe(4)
    expect(result.payments[1].interestCovered).toBe(0)
    expect(result.payments[1].fineCovered).toBe(11)
  })

  it('is stable when the in-flight id is replaced by a uuid on a later replay', () => {
    const t = '2026-09-03T15:00:00.000Z'
    const a = pay('zzz', 30, t, '2026-09-03T15:00:01.000Z')
    const b = pay('00000000-0000-4000-8000-000000000001', 30, t, '2026-09-03T15:00:09.000Z')
    const result = replayPayments(BASE, [b, a], new Date(t))
    expect(result.payments.map((p) => p.id)).toEqual(['zzz', b.id])
  })
})

describe('round2 half cents', () => {
  const halfCentAllocation = () =>
    allocatePayment({ amount: 100, amountPaid: 0, interestAmount: 1.005, fineAmount: 0 }, 50)

  // Each product is a half cent that binary arithmetic lands a hair below,
  // e.g. 13.5 * (1 / 100 / 30) * 30 is 0.13499999999999998.
  it.each([
    ['interest on 13.5 over 30 days', () => calculateInterest(13.5, 30, 1), 0.14],
    ['interest on 27 over 15 days', () => calculateInterest(27, 15, 1), 0.14],
    ['a 2% fine on 50.25', () => calculateFine(50.25, 'percentage', 2), 1.01],
    ['the interest an allocation covers', () => halfCentAllocation().interestCovered, 1.01],
    ['the principal left for that allocation', () => halfCentAllocation().principalCovered, 48.99],
  ])('rounds %s up', (_label, compute, expected) => {
    expect(compute()).toBe(expected)
  })

  it('rounds a half-cent fine up at the top of the amount range too', () => {
    // 2% of 26,214,403.25 is exactly 524,288.065; the product lands a hair
    // below it in binary and a fixed ten-decimal budget cannot see past that.
    expect(calculateFine(26_214_403.25, 'percentage', 2)).toBe(524_288.07)
  })

  it('keeps whole amounts, clean values and amounts below a cent as they are', () => {
    expect(calculateInterest(100, 30, 1)).toBe(1)
    expect(calculateInterest(1000, 3, 1)).toBe(1)
    expect(calculateInterest(0.0001, 1, 1)).toBe(0)
  })
})

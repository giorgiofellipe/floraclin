import { brDayIndex, ymdDayIndex } from '@/lib/dates'

const MAX_FINE_PERCENTAGE = 2
const MAX_INTEREST_MONTHLY = 1
const DAYS_IN_MONTH = 30

export interface InstallmentState {
  amount: number
  amountPaid: number
  fineAmount: number
  interestAmount: number
}

/** A stretch the installment spent cancelled. `to` is null while it still is. */
export interface PenaltyPause {
  from: string
  to: string | null
}

export interface InstallmentBase {
  amount: number
  dueDate: string
  appliedFineValue: number
  appliedFineType: string
  appliedInterestRate: number
  gracePeriodDays: number
  penaltyPauses: PenaltyPause[]
}

export interface PaymentInput {
  amount: number
  paidAt: string
  recordedAt: string
  id?: string
}

export interface PaymentAllocation {
  interestCovered: number
  fineCovered: number
  principalCovered: number
  excessAmount: number
}

export interface ReplayedPayment extends PaymentAllocation {
  amount: number
  paidAt: string
  id?: string
}

export interface ReplayResult {
  payments: ReplayedPayment[]
  installmentState: {
    amountPaid: number
    fineAmount: number
    interestAmount: number
    lastFineInterestCalcAt: string | null
    fineApplied: boolean
    carriedInterest: number
  }
}

export function round2(n: number): number {
  // Fifteen significant digits is what a double carries reliably, so rounding
  // to that recovers the decimal the arithmetic meant (0.135, not
  // 0.13499999999999998) for any amount the money columns can hold, before
  // the third decimal decides the cent, half up.
  const sign = n < 0 ? -1 : 1
  const text = Math.abs(n).toPrecision(15)
  if (text.includes('e')) return 0
  const [whole, frac = ''] = text.split('.')
  let cents = Number(whole) * 100 + Number(frac.slice(0, 2).padEnd(2, '0'))
  if (Number(frac[2] ?? '0') >= 5) cents += 1
  return (sign * cents) / 100
}

export function calculateFine(amount: number, fineType: string, fineValue: number): number {
  if (!fineValue || fineValue <= 0) return 0
  let fine: number
  if (fineType === 'percentage') {
    const rate = Math.min(fineValue, MAX_FINE_PERCENTAGE)
    fine = (amount * rate) / 100
  } else {
    const maxFine = (amount * MAX_FINE_PERCENTAGE) / 100
    fine = Math.min(fineValue, maxFine)
  }
  return round2(fine)
}

export function calculateInterest(
  remainingPrincipal: number,
  daysOverdue: number,
  monthlyRate: number,
): number {
  if (remainingPrincipal <= 0 || daysOverdue <= 0) return 0
  const cappedRate = Math.min(monthlyRate, MAX_INTEREST_MONTHLY)
  const dailyRate = cappedRate / 100 / DAYS_IN_MONTH
  return round2(remainingPrincipal * dailyRate * daysOverdue)
}

export function allocatePayment(
  state: InstallmentState,
  paymentAmount: number,
): PaymentAllocation {
  // Cap the payment at the total due (interest + fine + remaining principal)
  const maxPrincipal = round2(Math.max(state.amount - state.amountPaid, 0))
  const totalDue = round2(state.interestAmount + state.fineAmount + maxPrincipal)
  const cappedPayment = round2(Math.min(paymentAmount, totalDue))
  const excessAmount = round2(Math.max(paymentAmount - totalDue, 0))

  let remaining = cappedPayment

  const interestCovered = round2(Math.min(remaining, state.interestAmount))
  remaining = round2(remaining - interestCovered)

  const fineCovered = round2(Math.min(remaining, state.fineAmount))
  remaining = round2(remaining - fineCovered)

  const principalCovered = round2(Math.min(remaining, maxPrincipal))

  return { interestCovered, fineCovered, principalCovered, excessAmount }
}

/** BR day indices in (start, end]: the same half-open count interest uses. */
interface DaySpan {
  start: number
  end: number
}

/** Pauses as merged, sorted day spans, so overlapping pauses count once. */
function pausedSpans(base: InstallmentBase): DaySpan[] {
  const spans = base.penaltyPauses
    .map((p) => ({
      start: brDayIndex(new Date(p.from)),
      end: p.to === null ? Number.POSITIVE_INFINITY : brDayIndex(new Date(p.to)),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start)

  const merged: DaySpan[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

/** Days in (start, end] that fall outside every pause. */
function unpausedDays(paused: DaySpan[], start: number, end: number): number {
  if (end <= start) return 0
  let days = end - start
  for (const span of paused) {
    const overlap = Math.min(end, span.end) - Math.max(start, span.start)
    if (overlap > 0) days -= overlap
  }
  return days
}

/**
 * Day index of the last day that is NOT overdue: the due date plus grace,
 * where grace is spent only on days the installment was not paused.
 */
function lastGraceDayIndex(base: InstallmentBase, paused: DaySpan[]): number {
  let day = ymdDayIndex(base.dueDate)
  let graceLeft = base.gracePeriodDays
  for (const span of paused) {
    if (span.end <= day) continue
    const gap = Math.max(0, span.start - day)
    if (gap >= graceLeft) break
    graceLeft -= gap
    day = span.end
  }
  return day + graceLeft
}

/**
 * True once more unpaused days than grace have passed since the due date,
 * regardless of payments. The fine is gated on this and not on the interest
 * interval, which restarts at each payment and can stay under a day forever.
 */
function isOverdueAt(base: InstallmentBase, paused: DaySpan[], at: Date): boolean {
  return unpausedDays(paused, ymdDayIndex(base.dueDate), brDayIndex(at)) > base.gracePeriodDays
}

/** Whether the installment is late at `at`, net of grace and pauses. */
export function isInstallmentOverdue(base: InstallmentBase, at: Date): boolean {
  return isOverdueAt(base, pausedSpans(base), at)
}

/**
 * Whole unpaused BR calendar days of interest owed at `asOf`. The clock starts
 * the day after grace ends, or at the last payment, whichever is later.
 */
function daysOfInterest(
  base: InstallmentBase,
  paused: DaySpan[],
  lastCalcAt: string | null,
  asOf: Date,
): number {
  const start = Math.max(
    lastGraceDayIndex(base, paused),
    lastCalcAt ? brDayIndex(new Date(lastCalcAt)) : Number.NEGATIVE_INFINITY,
  )
  return unpausedDays(paused, start, brDayIndex(asOf))
}

export function replayPayments(
  base: InstallmentBase,
  payments: PaymentInput[],
  asOf: Date,
): ReplayResult {
  // paidAt is what the operator typed and is anchored to BR noon, so ties are
  // common. recordedAt is when the row was written, so it is the order the
  // payments actually happened in.
  const sorted = [...payments].sort((a, b) => {
    const byDate = new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
    if (byDate !== 0) return byDate
    const byRecorded = a.recordedAt.localeCompare(b.recordedAt)
    if (byRecorded !== 0) return byRecorded
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })

  const paused = pausedSpans(base)
  let amountPaid = 0
  let fineAmount = 0
  let fineApplied = false
  let carriedInterest = 0
  let lastCalcAt: string | null = null
  const replayedPayments: ReplayedPayment[] = []

  for (const payment of sorted) {
    const paymentDate = new Date(payment.paidAt)
    const daysOverdue = daysOfInterest(base, paused, lastCalcAt, paymentDate)

    const remainingPrincipal = round2(base.amount - amountPaid)
    if (!fineApplied && remainingPrincipal > 0 && isOverdueAt(base, paused, paymentDate)) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }

    // Interest a previous payment could not cover stays owed; it does not
    // vanish when the clock restarts at that payment's date.
    const interestAmount = round2(
      carriedInterest +
        calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate),
    )

    const allocation = allocatePayment(
      { amount: base.amount, amountPaid, fineAmount, interestAmount },
      payment.amount,
    )

    carriedInterest = round2(interestAmount - allocation.interestCovered)
    fineAmount = round2(fineAmount - allocation.fineCovered)
    amountPaid = round2(amountPaid + allocation.principalCovered)
    lastCalcAt = payment.paidAt

    replayedPayments.push({
      ...allocation,
      amount: payment.amount,
      paidAt: payment.paidAt,
      ...(payment.id != null ? { id: payment.id } : {}),
    })
  }

  const currentInterest = round2(
    carriedInterest +
      calculateInterest(
        round2(base.amount - amountPaid),
        daysOfInterest(base, paused, lastCalcAt, asOf),
        base.appliedInterestRate,
      ),
  )

  return {
    payments: replayedPayments,
    installmentState: {
      amountPaid,
      fineAmount,
      interestAmount: currentInterest,
      lastFineInterestCalcAt: lastCalcAt,
      fineApplied,
      carriedInterest,
    },
  }
}

export interface InstallmentQuote {
  remainingPrincipal: number
  fineAmount: number
  interestAmount: number
  totalDue: number
}

/**
 * What one installment owes at a given instant. Only the payments at or before
 * that instant count: a payment being recorded for a past date is inserted
 * chronologically by `replayPayments`, so pricing it against later payments
 * would quote a debt that had not been reduced yet.
 */
export function quoteInstallment(
  base: InstallmentBase,
  existingPayments: PaymentInput[],
  asOf: Date,
): InstallmentQuote {
  const upToAsOf = existingPayments.filter(
    (p) => new Date(p.paidAt).getTime() <= asOf.getTime(),
  )
  const replay = replayPayments(base, upToAsOf, asOf)
  const { amountPaid, lastFineInterestCalcAt, carriedInterest } = replay.installmentState

  const paused = pausedSpans(base)
  const daysOverdue = daysOfInterest(base, paused, lastFineInterestCalcAt, asOf)
  const remainingPrincipal = round2(Math.max(base.amount - amountPaid, 0))

  // No principal outstanding means nothing to be late on. A prepaid
  // installment must not grow a fine months after it was settled.
  const fineAmount =
    !replay.installmentState.fineApplied &&
    remainingPrincipal > 0 &&
    isOverdueAt(base, paused, asOf)
      ? calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      : replay.installmentState.fineAmount

  const interestAmount = round2(
    carriedInterest +
      calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate),
  )

  return {
    remainingPrincipal,
    fineAmount,
    interestAmount,
    totalDue: round2(remainingPrincipal + fineAmount + interestAmount),
  }
}

import { startOfBrDay } from '@/lib/dates'

const MAX_FINE_PERCENTAGE = 2
const MAX_INTEREST_MONTHLY = 1
const DAYS_IN_MONTH = 30

// Accepts either a bare YYYY-MM-DD (a BR calendar day — e.g. installment.dueDate)
// or a full ISO datetime (e.g. a prior lastFineInterestCalcAt).
// Bare YYYY-MM-DD is anchored to BR-local midnight so fine/interest day math
// stays correct on UTC hosts.
function parseOverdueReference(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfBrDay(value)
  return new Date(value)
}

export interface InstallmentState {
  amount: number
  amountPaid: number
  fineAmount: number
  interestAmount: number
}

export interface InstallmentBase {
  amount: number
  dueDate: string
  appliedFineValue: number
  appliedFineType: string
  appliedInterestRate: number
  gracePeriodDays: number
}

export interface PaymentInput {
  amount: number
  paidAt: string
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
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

export function getDaysOverdue(
  dueDate: string,
  gracePeriodDays: number,
  asOf?: Date,
): number {
  const due = parseOverdueReference(dueDate)
  const ref = asOf ?? new Date()
  const diffMs = ref.getTime() - due.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays - gracePeriodDays)
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

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Days of interest owed at `asOf`. The clock starts when the grace period ends
 * or at the last payment, whichever is later: a payment made before the due
 * date must not start it early, and must not forfeit the grace period.
 */
function daysOfInterest(
  base: InstallmentBase,
  lastCalcAt: string | null,
  asOf: Date,
): number {
  const graceEnd =
    parseOverdueReference(base.dueDate).getTime() + base.gracePeriodDays * MS_PER_DAY
  const start = Math.max(graceEnd, lastCalcAt ? new Date(lastCalcAt).getTime() : 0)
  return Math.max(0, Math.floor((asOf.getTime() - start) / MS_PER_DAY))
}

export function replayPayments(
  base: InstallmentBase,
  payments: PaymentInput[],
): ReplayResult {
  // Equal timestamps are common: the UI anchors every picked calendar day to
  // BR noon. Without the id tiebreak, database row order decides which payment
  // covers the interest.
  const sorted = [...payments].sort((a, b) => {
    const byDate = new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
    if (byDate !== 0) return byDate
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })

  let amountPaid = 0
  let fineAmount = 0
  let fineApplied = false
  let carriedInterest = 0
  let lastCalcAt: string | null = null
  const replayedPayments: ReplayedPayment[] = []

  for (const payment of sorted) {
    const paymentDate = new Date(payment.paidAt)
    const daysOverdue = daysOfInterest(base, lastCalcAt, paymentDate)

    if (!fineApplied && daysOverdue > 0) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }

    const remainingPrincipal = round2(base.amount - amountPaid)
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
        daysOfInterest(base, lastCalcAt, new Date()),
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
  const replay = replayPayments(base, upToAsOf)
  const { amountPaid, lastFineInterestCalcAt, carriedInterest } = replay.installmentState

  const daysOverdue = daysOfInterest(base, lastFineInterestCalcAt, asOf)

  const fineAmount =
    !replay.installmentState.fineApplied && daysOverdue > 0
      ? calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      : replay.installmentState.fineAmount

  const remainingPrincipal = round2(Math.max(base.amount - amountPaid, 0))
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

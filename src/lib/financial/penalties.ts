const MAX_FINE_PERCENTAGE = 2
const MAX_INTEREST_MONTHLY = 1
const DAYS_IN_MONTH = 30

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
}

export interface PaymentAllocation {
  interestCovered: number
  fineCovered: number
  principalCovered: number
}

export interface ReplayedPayment extends PaymentAllocation {
  amount: number
  paidAt: string
}

export interface ReplayResult {
  payments: ReplayedPayment[]
  installmentState: {
    amountPaid: number
    fineAmount: number
    interestAmount: number
    lastFineInterestCalcAt: string | null
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
  const due = new Date(dueDate)
  const ref = asOf ?? new Date()
  const diffMs = ref.getTime() - due.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays - gracePeriodDays)
}

export function allocatePayment(
  state: InstallmentState,
  paymentAmount: number,
): PaymentAllocation {
  let remaining = paymentAmount

  const interestCovered = round2(Math.min(remaining, state.interestAmount))
  remaining = round2(remaining - interestCovered)

  const fineCovered = round2(Math.min(remaining, state.fineAmount))
  remaining = round2(remaining - fineCovered)

  const maxPrincipal = round2(Math.max(state.amount - state.amountPaid, 0))
  const principalCovered = round2(Math.min(remaining, maxPrincipal))

  return { interestCovered, fineCovered, principalCovered }
}

export function replayPayments(
  base: InstallmentBase,
  payments: PaymentInput[],
): ReplayResult {
  // Sort by paidAt ascending
  const sorted = [...payments].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime(),
  )

  let amountPaid = 0
  let fineAmount = 0
  let fineApplied = false
  let lastCalcAt: string | null = null
  const replayedPayments: ReplayedPayment[] = []

  for (const payment of sorted) {
    const paymentDate = new Date(payment.paidAt)
    const interestStartDate = lastCalcAt ? lastCalcAt : base.dueDate
    const daysOverdue = getDaysOverdue(interestStartDate, lastCalcAt ? 0 : base.gracePeriodDays, paymentDate)

    // Apply fine once on first overdue payment
    if (!fineApplied && daysOverdue > 0 && amountPaid === 0) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }

    const remainingPrincipal = base.amount - amountPaid
    const interestAmount = calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate)

    const allocation = allocatePayment(
      { amount: base.amount, amountPaid, fineAmount, interestAmount },
      payment.amount,
    )

    fineAmount = round2(fineAmount - allocation.fineCovered)
    amountPaid = round2(amountPaid + allocation.principalCovered)
    lastCalcAt = payment.paidAt

    replayedPayments.push({
      ...allocation,
      amount: payment.amount,
      paidAt: payment.paidAt,
    })
  }

  // Recalculate current interest for display
  const currentDaysOverdue = getDaysOverdue(
    lastCalcAt ?? base.dueDate,
    lastCalcAt ? 0 : base.gracePeriodDays,
  )
  const currentInterest = calculateInterest(base.amount - amountPaid, currentDaysOverdue, base.appliedInterestRate)

  return {
    payments: replayedPayments,
    installmentState: {
      amountPaid,
      fineAmount,
      interestAmount: currentInterest,
      lastFineInterestCalcAt: lastCalcAt,
    },
  }
}

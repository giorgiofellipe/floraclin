import { round2 } from './penalties'

type Amount = number | string | null | undefined

export interface PatientEntryTotalsInput {
  status: string
  isOverdue: boolean
  totalAmount: Amount
  totalAmountPaid: Amount
  totalFineAmount: Amount
  totalInterestAmount: Amount
}

export interface PatientEntryTotals {
  pending: number
  overdue: number
  paid: number
}

/** Pendente / Atrasado / Pago of a patient's entries, as listed by `listFinancialEntries`. */
export function summarizePatientEntries(entries: PatientEntryTotalsInput[]): PatientEntryTotals {
  let pending = 0
  let overdue = 0
  let paid = 0
  for (const entry of entries) {
    const charged =
      Number(entry.totalAmount ?? 0) +
      Number(entry.totalFineAmount ?? 0) +
      Number(entry.totalInterestAmount ?? 0)
    const amountPaid = Number(entry.totalAmountPaid ?? 0)

    if (entry.status === 'paid') {
      paid += charged
    } else if (entry.isOverdue) {
      overdue += charged - amountPaid
    } else if (entry.status === 'pending' || entry.status === 'partial') {
      pending += charged - amountPaid
    }
  }
  return { pending: round2(pending), overdue: round2(overdue), paid: round2(paid) }
}

/** The patient Financeiro section reads one page of this size; the Resumo reads the same page. */
export const PATIENT_FINANCIAL_ENTRIES_LIMIT = 100

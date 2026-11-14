import { shiftBrYmd, ymdDayIndex } from '@/lib/dates'
import { formatCurrency, formatDate } from '@/lib/utils'

export type CardMethod = 'credit_card' | 'debit_card'
export type CardPayoutMode = 'per_installment' | 'lump_sum' | 'debit'

/** A null rate is one the clinic has not told us yet. */
export interface CardTerminalTerms {
  debitRate: number | null
  debitPayoutDays: number
  creditRates: (number | null)[]
  creditPayoutMode: 'per_installment' | 'lump_sum'
  creditLumpSumDays: number
}

export interface CardPaymentSummary {
  terminalName: string
  method: string
  installmentCount: number
  pendingRepasses: number
  receivedRepasses: number
  linkedPaymentCount: number
}

export function isCardMethod(method: string | null | undefined): method is CardMethod {
  return method === 'credit_card' || method === 'debit_card'
}

export function cardInstallmentCountFor(method: CardMethod, count: number): number {
  return method === 'debit_card' ? 1 : count
}

const toRate = (value: string | null) => (value === null ? null : Number(value))

/** The rate this sale is priced at, or null when the terminal does not know it yet. */
export function cardRateFor(terms: Pick<CardTerminalTerms, 'debitRate' | 'creditRates'>, method: CardMethod, installmentCount: number): number | null {
  return method === 'debit_card' ? terms.debitRate : (terms.creditRates[installmentCount - 1] ?? null)
}

export function toCardTerminalTerms(row: {
  debitRate: string | null
  debitPayoutDays: number
  creditRates: (string | null)[]
  creditPayoutMode: 'per_installment' | 'lump_sum'
  creditLumpSumDays: number
}): CardTerminalTerms {
  return {
    debitRate: toRate(row.debitRate),
    debitPayoutDays: row.debitPayoutDays,
    creditRates: row.creditRates.map(toRate),
    creditPayoutMode: row.creditPayoutMode,
    creditLumpSumDays: row.creditLumpSumDays,
  }
}

export interface PlannedRepasse {
  sequence: number
  expectedDate: string
  grossAmount: number
  feeAmount: number
  netAmount: number
}

export interface CardSchedule {
  rate: number
  payoutMode: CardPayoutMode
  grossAmount: number
  feeAmount: number
  netAmount: number
  repasses: PlannedRepasse[]
}

const toCents = (value: number) => Math.round(value * 100)
const fromCents = (cents: number) => cents / 100

function isWeekend(ymd: string): boolean {
  // Epoch day 0 is a Thursday.
  const weekday = (ymdDayIndex(ymd) + 4) % 7
  return weekday === 0 || weekday === 6
}

export function addBusinessDays(ymd: string, days: number): string {
  let current = ymd
  let remaining = days
  while (remaining > 0) {
    current = shiftBrYmd(current, 1)
    if (!isWeekend(current)) remaining -= 1
  }
  return current
}

function splitCents(total: number, parts: number): number[] {
  const base = Math.floor(total / parts)
  return Array.from({ length: parts }, (_, i) =>
    i === parts - 1 ? total - base * (parts - 1) : base,
  )
}

export function buildCardSchedule(input: {
  gross: number
  method: CardMethod
  installmentCount: number
  terms: CardTerminalTerms
  paymentYmd: string
}): CardSchedule {
  const { gross, method, terms, paymentYmd } = input
  const isDebit = method === 'debit_card'
  const installmentCount = isDebit ? 1 : input.installmentCount
  const rate = cardRateFor(terms, method, installmentCount)
  if (rate === null) throw new Error(`No ${method} rate for ${installmentCount}x on this terminal`)

  const grossCents = toCents(gross)
  const feeCents = Math.round((grossCents * rate) / 100)
  const netCents = grossCents - feeCents

  let payoutMode: CardPayoutMode
  let dates: string[]
  if (isDebit) {
    payoutMode = 'debit'
    dates = [addBusinessDays(paymentYmd, terms.debitPayoutDays)]
  } else if (terms.creditPayoutMode === 'lump_sum') {
    payoutMode = 'lump_sum'
    dates = [addBusinessDays(paymentYmd, terms.creditLumpSumDays)]
  } else {
    payoutMode = 'per_installment'
    dates = Array.from({ length: installmentCount }, (_, i) =>
      shiftBrYmd(paymentYmd, 30 * (i + 1)),
    )
  }

  const nets = splitCents(netCents, dates.length)
  const fees = splitCents(feeCents, dates.length)

  return {
    rate,
    payoutMode,
    grossAmount: fromCents(grossCents),
    feeAmount: fromCents(feeCents),
    netAmount: fromCents(netCents),
    repasses: dates.map((expectedDate, i) => ({
      sequence: i + 1,
      expectedDate,
      grossAmount: fromCents(nets[i] + fees[i]),
      feeAmount: fromCents(fees[i]),
      netAmount: fromCents(nets[i]),
    })),
  }
}

export function describeCardSchedule(schedule: CardSchedule): string {
  const [first] = schedule.repasses
  const amount = formatCurrency(first.netAmount).replace(/ /g, ' ')
  if (schedule.repasses.length > 1) {
    return `${schedule.repasses.length} repasses de ${amount}, a partir de ${formatDate(first.expectedDate)}`
  }
  const suffix = schedule.payoutMode === 'lump_sum' ? ' (antecipado)' : ''
  return `1 repasse de ${amount} em ${formatDate(first.expectedDate)}${suffix}`
}

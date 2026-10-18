import { shiftBrYmd, ymdDayIndex } from '@/lib/dates'
import { formatCurrency } from '@/lib/utils'

export type CardMethod = 'credit_card' | 'debit_card'
export type CardPayoutMode = 'per_installment' | 'lump_sum' | 'debit'

export interface CardTerminalTerms {
  debitRate: number
  debitPayoutDays: number
  creditRates: number[]
  creditPayoutMode: 'per_installment' | 'lump_sum'
  creditLumpSumDays: number
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
  const rate = isDebit ? terms.debitRate : terms.creditRates[installmentCount - 1]

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

function formatBrDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

export function describeCardSchedule(schedule: CardSchedule): string {
  const [first] = schedule.repasses
  const amount = formatCurrency(first.netAmount).replace(/ /g, ' ')
  if (schedule.repasses.length > 1) {
    return `${schedule.repasses.length} repasses de ${amount}, a partir de ${formatBrDate(first.expectedDate)}`
  }
  const suffix = schedule.payoutMode === 'lump_sum' ? ' (antecipado)' : ''
  return `1 repasse de ${amount} em ${formatBrDate(first.expectedDate)}${suffix}`
}

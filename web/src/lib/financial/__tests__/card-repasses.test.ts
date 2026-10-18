import { describe, it, expect } from 'vitest'
import {
  addBusinessDays,
  buildCardSchedule,
  describeCardSchedule,
  type CardTerminalTerms,
} from '../card-repasses'

function terms(overrides: Partial<CardTerminalTerms> = {}): CardTerminalTerms {
  const creditRates = Array.from({ length: 12 }, () => 0)
  return {
    debitRate: 1.5,
    debitPayoutDays: 1,
    creditRates,
    creditPayoutMode: 'per_installment',
    creditLumpSumDays: 1,
    ...overrides,
  }
}

function ratesWith(index: number, rate: number): number[] {
  const rates = Array.from({ length: 12 }, () => 0)
  rates[index] = rate
  return rates
}

describe('buildCardSchedule', () => {
  it('splits a per-installment sale into 30-day repasses that sum to the net', () => {
    const s = buildCardSchedule({
      gross: 3000,
      method: 'credit_card',
      installmentCount: 6,
      terms: terms({ creditRates: ratesWith(5, 8.99) }),
      paymentYmd: '2026-10-18',
    })
    expect(s.feeAmount).toBe(269.7)
    expect(s.netAmount).toBe(2730.3)
    expect(s.repasses).toHaveLength(6)
    expect(s.repasses[0].expectedDate).toBe('2026-11-17')
    expect(s.repasses[0].netAmount).toBe(455.05)
    const netSum = s.repasses.reduce((acc, r) => acc + Math.round(r.netAmount * 100), 0)
    expect(netSum).toBe(273030)
  })

  it('pays a lump-sum sale once, on the next business day after a Sunday payment', () => {
    const s = buildCardSchedule({
      gross: 3000,
      method: 'credit_card',
      installmentCount: 6,
      terms: terms({
        creditRates: ratesWith(5, 11.49),
        creditPayoutMode: 'lump_sum',
        creditLumpSumDays: 1,
      }),
      paymentYmd: '2026-10-18',
    })
    expect(s.payoutMode).toBe('lump_sum')
    expect(s.feeAmount).toBe(344.7)
    expect(s.netAmount).toBe(2655.3)
    expect(s.repasses).toHaveLength(1)
    expect(s.repasses[0].expectedDate).toBe('2026-10-19')
  })

  it('gives the cent remainder to the last repasse', () => {
    const s = buildCardSchedule({
      gross: 100,
      method: 'credit_card',
      installmentCount: 3,
      terms: terms(),
      paymentYmd: '2026-10-18',
    })
    expect(s.repasses.map((r) => r.netAmount)).toEqual([33.33, 33.33, 33.34])
  })

  it('splits net and fee separately so every row grosses to net plus fee', () => {
    const s = buildCardSchedule({
      gross: 100,
      method: 'credit_card',
      installmentCount: 3,
      terms: terms({ creditRates: ratesWith(2, 2) }),
      paymentYmd: '2026-10-18',
    })
    expect(s.feeAmount).toBe(2)
    expect(s.repasses.map((r) => r.netAmount)).toEqual([32.66, 32.66, 32.68])
    expect(s.repasses.map((r) => r.feeAmount)).toEqual([0.66, 0.66, 0.68])
    for (const r of s.repasses) {
      expect(Math.round(r.grossAmount * 100)).toBe(
        Math.round(r.netAmount * 100) + Math.round(r.feeAmount * 100),
      )
    }
  })

  it('forces debit to a single installment at the debit rate', () => {
    const s = buildCardSchedule({
      gross: 200,
      method: 'debit_card',
      installmentCount: 6,
      terms: terms({ creditRates: ratesWith(5, 9) }),
      paymentYmd: '2026-10-16',
    })
    expect(s.payoutMode).toBe('debit')
    expect(s.rate).toBe(1.5)
    expect(s.feeAmount).toBe(3)
    expect(s.repasses).toHaveLength(1)
    expect(s.repasses[0].expectedDate).toBe('2026-10-19')
  })
})

describe('addBusinessDays', () => {
  it('skips the weekend from a Friday', () => {
    expect(addBusinessDays('2026-10-16', 1)).toBe('2026-10-19')
  })

  it('returns the same day for zero days, even on a weekend', () => {
    expect(addBusinessDays('2026-10-18', 0)).toBe('2026-10-18')
  })
})

describe('describeCardSchedule', () => {
  it('describes a multi-repasse schedule from the first net', () => {
    const s = buildCardSchedule({
      gross: 3000,
      method: 'credit_card',
      installmentCount: 6,
      terms: terms({ creditRates: ratesWith(5, 8.99) }),
      paymentYmd: '2026-10-18',
    })
    expect(describeCardSchedule(s)).toBe('6 repasses de R$ 455,05, a partir de 17/11/2026')
  })

  it('marks a lump-sum repasse as antecipado', () => {
    const s = buildCardSchedule({
      gross: 3000,
      method: 'credit_card',
      installmentCount: 6,
      terms: terms({
        creditRates: ratesWith(5, 11.49),
        creditPayoutMode: 'lump_sum',
      }),
      paymentYmd: '2026-10-18',
    })
    expect(describeCardSchedule(s)).toBe('1 repasse de R$ 2.655,30 em 19/10/2026 (antecipado)')
  })
})

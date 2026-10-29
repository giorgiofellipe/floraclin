import { describe, it, expect } from 'vitest'
import { discountSummaryLine, referralCountFromPercent } from '../billing-discount-copy'

const NOW = new Date('2026-10-21T15:00:00.000Z')

describe('discountSummaryLine', () => {
  it('shows the referral discount with the amount saved', () => {
    expect(
      discountSummaryLine(
        { discountedCents: 5940, fullCents: 9900, endsAt: null, referralPercent: 40 },
        { cancelPending: false, now: NOW },
      ),
    ).toBe('R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes')
  })

  it('is singular at one paying referral', () => {
    expect(
      discountSummaryLine(
        { discountedCents: 7920, fullCents: 9900, endsAt: null, referralPercent: 20 },
        { cancelPending: false, now: NOW },
      ),
    ).toBe('R$ 99,00 → R$ 79,20/mês · 20% de desconto por 1 indicação pagante')
  })

  it('adds the entry coupon end date and the price after it', () => {
    expect(
      discountSummaryLine(
        { discountedCents: 4752, fullCents: 9900, endsAt: '2026-12-21T15:00:00.000Z', afterEndsCents: 5940, referralPercent: 40 },
        { cancelPending: false, now: NOW },
      ),
    ).toBe('R$ 99,00 → R$ 47,52/mês até 21/12, depois R$ 59,40 · 40% de desconto por 2 indicações pagantes')
  })

  it('keeps the win-back wording when there is no referral part', () => {
    const d = { discountedCents: 6930, fullCents: 9900, endsAt: '2026-12-31T15:00:00.000Z' }
    expect(discountSummaryLine(d, { cancelPending: false, now: NOW })).toBe('R$ 69,30/mês até 31/12, depois R$ 99,00')
    expect(discountSummaryLine({ ...d, endsAt: '2027-02-10T15:00:00.000Z' }, { cancelPending: false, now: NOW })).toBe(
      'R$ 69,30/mês até 10/02/2027, depois R$ 99,00',
    )
    expect(discountSummaryLine({ ...d, endsAt: null }, { cancelPending: false, now: NOW })).toBe(
      'R$ 69,30/mês com desconto (sem desconto: R$ 99,00)',
    )
  })

  it('drops the "depois" clause when a cancellation is pending', () => {
    const win = { discountedCents: 6930, fullCents: 9900, endsAt: '2026-12-31T15:00:00.000Z' }
    expect(discountSummaryLine(win, { cancelPending: true, now: NOW })).toBe('R$ 69,30/mês com desconto')
    expect(
      discountSummaryLine({ ...win, discountedCents: 4752, afterEndsCents: 5940, referralPercent: 40 }, { cancelPending: true, now: NOW }),
    ).toBe('R$ 99,00 → R$ 47,52/mês · 40% de desconto por 2 indicações pagantes')
  })
})

describe('referralCountFromPercent', () => {
  it('is percent / 20', () => {
    expect([20, 60, 100].map(referralCountFromPercent)).toEqual([1, 3, 5])
  })
})

import { describe, expect, it } from 'vitest'
import {
  isReferralEligiblePlan,
  normalizeReferralCode,
  referralBonusCredits,
  referralDiscountPercent,
  referralDiscountTable,
  referralLink,
  shortClinicName,
} from '../rules'

describe('referralDiscountPercent', () => {
  it.each([
    [0, 0], [1, 20], [2, 40], [3, 60], [4, 80], [5, 100], [9, 100], [-1, 0], [NaN, 0],
  ])('counting %s gives %s%%', (counting, percent) => {
    expect(referralDiscountPercent(counting)).toBe(percent)
  })
})

describe('referralBonusCredits', () => {
  it('is 100 per counting referral past 5', () => {
    expect([0, 3, 5].map((c) => referralBonusCredits(c, 500))).toEqual([0, 0, 0])
    expect(referralBonusCredits(6, 500)).toBe(100)
    expect(referralBonusCredits(8, 500)).toBe(300)
  })
  it('is 0 on an unlimited plan', () => {
    expect(referralBonusCredits(8, -1)).toBe(0)
  })
})

describe('normalizeReferralCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeReferralCode(' meca7k ')).toBe('MECA7K')
  })
  it.each(['ME0A7K', 'MICA7K', 'ABC', 'ABCDEFGHJKMNP', 42, undefined])('rejects %s', (raw) => {
    expect(normalizeReferralCode(raw)).toBeNull()
  })
})

describe('shortClinicName', () => {
  it('leaves a short name unchanged and collapses whitespace', () => {
    expect(shortClinicName('Clínica Bela')).toBe('Clínica Bela')
    expect(shortClinicName('  Clínica   \n Bela ')).toBe('Clínica Bela')
  })
  it('cuts a long name at a word boundary', () => {
    const out = shortClinicName('Clínica de Estética Avançada e Harmonização Facial Bela Vista')
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toBe('Clínica de Estética Avançada e…')
  })
  it('hard-cuts a long single word', () => {
    const out = shortClinicName('A'.repeat(60))
    expect(out).toBe(`${'A'.repeat(39)}…`)
  })
})

describe('referralLink', () => {
  it('builds the landing URL', () => {
    expect(referralLink('ABC234')).toBe('https://floraclin.com.br/indicacao/ABC234')
  })
})

describe('isReferralEligiblePlan', () => {
  it('is true only for monthly', () => {
    expect(isReferralEligiblePlan({ billingInterval: 'month' })).toBe(true)
    expect(isReferralEligiblePlan({ billingInterval: 'year' })).toBe(false)
    expect(isReferralEligiblePlan({ billingInterval: null })).toBe(false)
    expect(isReferralEligiblePlan({ billingInterval: undefined })).toBe(false)
  })
})

describe('referralDiscountTable', () => {
  it('has 5 rows ending at 100%', () => {
    const table = referralDiscountTable()
    expect(table).toHaveLength(5)
    expect(table[0]).toEqual({ counting: 1, percent: 20 })
    expect(table[4]).toEqual({ counting: 5, percent: 100 })
  })
})

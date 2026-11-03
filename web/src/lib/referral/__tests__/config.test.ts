import { describe, expect, it, vi } from 'vitest'
import {
  areReferralRewardsActive,
  canRefer,
  subscribingUnlocksReferral,
  couponIdForPercent,
  isReferralEnrollmentEnabled,
  isReferrerCoupon,
  referralRewardsEndAt,
  referrerCouponIds,
} from '../config'

const COUPONS = 'c20,c40,c60,c80,c100'
const READY = { STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_1', STRIPE_REFERRER_COUPON_IDS: COUPONS }
const BEFORE = new Date('2026-11-01T00:00:00Z')
const END = '2026-12-01T00:00:00-03:00'

describe('referrerCouponIds', () => {
  it('parses exactly five ids in order', () => {
    expect(referrerCouponIds({ STRIPE_REFERRER_COUPON_IDS: ` ${COUPONS} ` })).toEqual({
      20: 'c20', 40: 'c40', 60: 'c60', 80: 'c80', 100: 'c100',
    })
  })
  it.each(['c20,c40,c60,c80', 'c20,c40,c60,c80,c100,c120', 'c20,,c60,c80,c100', ''])(
    'treats %j as unconfigured',
    (raw) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(referrerCouponIds({ STRIPE_REFERRER_COUPON_IDS: raw })).toBeNull()
    },
  )
  it('is null when unset', () => {
    expect(referrerCouponIds({})).toBeNull()
  })
})

describe('isReferralEnrollmentEnabled', () => {
  it.each([undefined, '1', 'TRUE ', 'false'])('is off when the switch is %j', (flag) => {
    expect(isReferralEnrollmentEnabled({ ...READY, REFERRAL_ENROLLMENT_ENABLED: flag }, BEFORE)).toBe(false)
  })
  it('is on only with the switch, the promo id and the coupons', () => {
    const on = { ...READY, REFERRAL_ENROLLMENT_ENABLED: 'true' }
    expect(isReferralEnrollmentEnabled(on, BEFORE)).toBe(true)
    expect(isReferralEnrollmentEnabled({ ...on, STRIPE_REFERRAL_PROMOTION_CODE_ID: undefined }, BEFORE)).toBe(false)
    expect(isReferralEnrollmentEnabled({ ...on, STRIPE_REFERRER_COUPON_IDS: undefined }, BEFORE)).toBe(false)
  })
  it('is off at or after the end date', () => {
    const env = { ...READY, REFERRAL_ENROLLMENT_ENABLED: 'true', REFERRAL_REWARDS_END_AT: END }
    expect(isReferralEnrollmentEnabled(env, new Date(END))).toBe(false)
    expect(isReferralEnrollmentEnabled(env, new Date('2027-01-01T00:00:00Z'))).toBe(false)
    expect(isReferralEnrollmentEnabled(env, BEFORE)).toBe(true)
  })
})

describe('areReferralRewardsActive', () => {
  it('is true before the end date and false after it', () => {
    const env = { ...READY, REFERRAL_REWARDS_END_AT: END }
    expect(areReferralRewardsActive(env, BEFORE)).toBe(true)
    expect(areReferralRewardsActive(env, new Date('2026-12-01T03:00:00Z'))).toBe(false)
  })
  it('is false without coupons', () => {
    expect(areReferralRewardsActive({}, BEFORE)).toBe(false)
  })
})

describe('referralRewardsEndAt', () => {
  it('rejects a bare date', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(referralRewardsEndAt({ REFERRAL_REWARDS_END_AT: '2026-12-01' })).toBeNull()
  })
  it('accepts a full ISO timestamp', () => {
    expect(referralRewardsEndAt({ REFERRAL_REWARDS_END_AT: END })?.toISOString()).toBe('2026-12-01T03:00:00.000Z')
  })
})

describe('couponIdForPercent', () => {
  const ids = referrerCouponIds({ STRIPE_REFERRER_COUPON_IDS: COUPONS })!
  it('maps percents and returns null for 0', () => {
    expect(couponIdForPercent(60, ids)).toBe('c60')
    expect(couponIdForPercent(0, ids)).toBeNull()
  })
})

describe('isReferrerCoupon', () => {
  const ids = referrerCouponIds({ STRIPE_REFERRER_COUPON_IDS: COUPONS })!
  it('recognises a coupon by id or metadata', () => {
    expect(isReferrerCoupon({ id: 'c40' }, ids)).toBe(true)
    expect(isReferrerCoupon({ id: 'other', metadata: { purpose: 'referral_reward' } }, null)).toBe(true)
    expect(isReferrerCoupon({ id: 'other', metadata: {} }, ids)).toBe(false)
    expect(isReferrerCoupon({ id: 'c40' }, null)).toBe(false)
  })
})

describe('canRefer', () => {
  const NOW = new Date('2026-11-03T12:00:00Z')
  const OPEN = new Date('2026-12-01T12:00:00Z')
  const CLOSED = new Date('2026-11-01T12:00:00Z')
  it.each([
    ['a paying Stripe clinic', { source: 'stripe', status: 'active', currentPeriodEnd: CLOSED }, true],
    ['a running gift', { source: 'gift', status: 'active', currentPeriodEnd: OPEN }, true],
    ['a running admin grant', { source: 'admin', status: 'active', currentPeriodEnd: OPEN }, true],
    ['a gift past its end before the expiry cron ran', { source: 'gift', status: 'active', currentPeriodEnd: CLOSED }, false],
    ['a trial', { source: 'trial', status: 'trialing', currentPeriodEnd: OPEN }, false],
    ['a Stripe clinic with a failed payment', { source: 'stripe', status: 'past_due', currentPeriodEnd: OPEN }, false],
    ['a canceled Stripe clinic', { source: 'stripe', status: 'canceled', currentPeriodEnd: OPEN }, false],
    ['no subscription', null, false],
  ])('%s', (_n, row, expected) => {
    expect(canRefer(row, NOW)).toBe(expected)
  })
})

describe('subscribingUnlocksReferral', () => {
  const OPEN = new Date('2099-01-01T12:00:00Z')
  it.each([
    ['a trial', { source: 'trial', status: 'trialing', currentPeriodEnd: OPEN }, true],
    ['an expired gift', { source: 'gift', status: 'expired', currentPeriodEnd: null }, true],
    ['a canceled Stripe clinic', { source: 'stripe', status: 'canceled', currentPeriodEnd: OPEN }, true],
    ['a clinic that can already refer', { source: 'gift', status: 'active', currentPeriodEnd: OPEN }, false],
    ['a Stripe clinic with a failed payment, which fixes the card instead', { source: 'stripe', status: 'past_due', currentPeriodEnd: OPEN }, false],
    ['a Stripe trial, which becomes active on its own', { source: 'stripe', status: 'trialing', currentPeriodEnd: OPEN }, false],
    ['no subscription row, whose billing tab cannot load', null, false],
  ])('%s', (_n, row, expected) => {
    expect(subscribingUnlocksReferral(row)).toBe(expected)
  })
})

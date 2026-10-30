import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import {
  FEEDBACK_COUPON_ID,
  FEEDBACK_COUPON_SPEC,
  FEEDBACK_PROMOTION_CODE,
  setupFeedbackCoupon,
  type FeedbackCouponSetupDeps,
} from '../feedback-coupon-setup'
import type { CouponSpec } from '../referral/coupon-setup'

function asCoupon(spec: Partial<CouponSpec> & { id: string }): Stripe.Coupon {
  return spec as unknown as Stripe.Coupon
}

function asPromo(id: string, firstTimeTransaction: boolean): Stripe.PromotionCode {
  return { id, restrictions: { first_time_transaction: firstTimeTransaction } } as unknown as Stripe.PromotionCode
}

function makeDeps(overrides: Partial<FeedbackCouponSetupDeps> = {}) {
  return {
    retrieveCoupon: vi.fn(async () => null),
    createCoupon: vi.fn(async (spec: CouponSpec) => asCoupon(spec)),
    findPromotionCode: vi.fn(async () => null),
    createPromotionCode: vi.fn(async () => asPromo('promo_new', true)),
    log: vi.fn(),
    ...overrides,
  } satisfies FeedbackCouponSetupDeps
}

describe('FEEDBACK_COUPON_SPEC', () => {
  it('is 50% for 3 months, with no product restriction', () => {
    expect(FEEDBACK_COUPON_SPEC).toEqual({
      id: 'floraclin_feedback_50x3',
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 3,
      name: 'Feedback: 50% nos 3 primeiros meses',
      metadata: { purpose: 'feedback_reward', app: 'floraclin' },
    })
  })
})

describe('setupFeedbackCoupon', () => {
  it('creates the coupon and the promotion code on a fresh account and prints the env line', async () => {
    const deps = makeDeps()
    const result = await setupFeedbackCoupon(deps)
    expect(deps.createCoupon).toHaveBeenCalledWith(FEEDBACK_COUPON_SPEC)
    expect(deps.createPromotionCode).toHaveBeenCalledWith({ couponId: FEEDBACK_COUPON_ID, code: FEEDBACK_PROMOTION_CODE })
    expect(result.envLines).toEqual(['STRIPE_FEEDBACK_PROMOTION_CODE_ID=promo_new'])
  })

  it('is idempotent: a second run reuses both and creates nothing', async () => {
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async () => asCoupon(FEEDBACK_COUPON_SPEC)),
      findPromotionCode: vi.fn(async () => asPromo('promo_existing', true)),
    })
    const result = await setupFeedbackCoupon(deps)
    expect(deps.createCoupon).not.toHaveBeenCalled()
    expect(deps.createPromotionCode).not.toHaveBeenCalled()
    expect(deps.findPromotionCode).toHaveBeenCalledWith(FEEDBACK_COUPON_ID, FEEDBACK_PROMOTION_CODE)
    expect(result.promotionCodeId).toBe('promo_existing')
  })

  it('refuses an existing promotion code without the first-time restriction', async () => {
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async () => asCoupon(FEEDBACK_COUPON_SPEC)),
      findPromotionCode: vi.fn(async () => asPromo('promo_handmade', false)),
    })
    await expect(setupFeedbackCoupon(deps)).rejects.toThrow(/promo_handmade.*first_time_transaction/)
    expect(deps.createPromotionCode).not.toHaveBeenCalled()
  })

  it('checks the created promotion code too: one without the first-time restriction fails the run', async () => {
    const deps = makeDeps({ createPromotionCode: vi.fn(async () => asPromo('promo_unrestricted', false)) })
    await expect(setupFeedbackCoupon(deps)).rejects.toThrow(/first_time_transaction/)
  })

  it('refuses to reuse a coupon with the same id but other terms', async () => {
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async () => asCoupon({ ...FEEDBACK_COUPON_SPEC, duration_in_months: 2 })),
    })
    await expect(setupFeedbackCoupon(deps)).rejects.toThrow(/different terms/)
    expect(deps.createPromotionCode).not.toHaveBeenCalled()
  })
})

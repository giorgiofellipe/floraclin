import { assertSameTerms, type CouponSetupDeps, type CouponSpec } from '@/lib/referral/coupon-setup'

/**
 * Spec and guarded creator for the feedback reward coupon and its promotion
 * code. Used only by `scripts/create-feedback-coupon.ts`; runtime code never
 * creates Stripe objects. No `applies_to`, like the referral coupons: the
 * account sells only the Starter and Pro subscriptions, and the offer reads
 * any restriction from the coupon anyway (see getValidatedFeedbackOffer).
 */

export const FEEDBACK_COUPON_ID = 'floraclin_feedback_50x3'
// Never typed by clinics: the server attaches it only for a flagged tenant. Stripe requires a code string.
export const FEEDBACK_PROMOTION_CODE = 'FEEDBACK50'

export const FEEDBACK_COUPON_SPEC: CouponSpec = {
  id: FEEDBACK_COUPON_ID,
  percent_off: 50,
  duration: 'repeating',
  duration_in_months: 3,
  name: 'Feedback: 50% nos 3 primeiros meses',
  metadata: { purpose: 'feedback_reward', app: 'floraclin' },
}

/**
 * Same deps as the referral setup. `createPromotionCode` creates
 * `promotion: { type: 'coupon', coupon }`, `code`,
 * `restrictions: { first_time_transaction: true }`,
 * `metadata: { purpose: 'feedback_reward', app: 'floraclin' }`.
 */
export type FeedbackCouponSetupDeps = CouponSetupDeps

export async function setupFeedbackCoupon(
  deps: FeedbackCouponSetupDeps,
): Promise<{ promotionCodeId: string; envLines: string[] }> {
  const spec = FEEDBACK_COUPON_SPEC
  const existing = await deps.retrieveCoupon(spec.id)
  if (existing) {
    assertSameTerms(existing, spec)
    deps.log(`coupon ${spec.id}: already exists, terms match`)
  } else {
    await deps.createCoupon(spec)
    deps.log(`coupon ${spec.id}: created`)
  }

  let promo = await deps.findPromotionCode(FEEDBACK_COUPON_ID, FEEDBACK_PROMOTION_CODE)
  if (promo) {
    deps.log(`promotion code ${FEEDBACK_PROMOTION_CODE}: already exists (${promo.id})`)
  } else {
    promo = await deps.createPromotionCode({ couponId: FEEDBACK_COUPON_ID, code: FEEDBACK_PROMOTION_CODE })
    deps.log(`promotion code ${FEEDBACK_PROMOTION_CODE}: created (${promo.id})`)
  }
  // The code is reusable by design: only Stripe's first-purchase restriction
  // keeps a paying clinic from getting it. A hand-made FEEDBACK50 without it
  // must not be adopted.
  if (promo.restrictions?.first_time_transaction !== true) {
    throw new Error(
      `promotion code ${FEEDBACK_PROMOTION_CODE} (${promo.id}) lacks restrictions.first_time_transaction; deactivate it in Stripe and re-run`,
    )
  }

  return { promotionCodeId: promo.id, envLines: [`STRIPE_FEEDBACK_PROMOTION_CODE_ID=${promo.id}`] }
}

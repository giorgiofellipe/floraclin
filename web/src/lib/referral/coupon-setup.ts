import type Stripe from 'stripe'

/**
 * Spec and guarded creator for the referral program's Stripe coupons. Used only
 * by `scripts/create-referral-coupons.ts`; runtime code never creates Stripe
 * objects. None of these coupons use `applies_to`.
 */

export const WELCOME_COUPON_ID = 'floraclin_referral_new_20x2'
// Never typed by clinics; Stripe requires a code string.
export const WELCOME_PROMOTION_CODE = 'INDICA20'
export const REFERRER_COUPON_IDS = [
  'floraclin_referrer_20',
  'floraclin_referrer_40',
  'floraclin_referrer_60',
  'floraclin_referrer_80',
  'floraclin_referrer_100',
] as const

const REFERRER_PERCENTS = [20, 40, 60, 80, 100] as const

export interface CouponSpec {
  id: string
  percent_off: number
  duration: 'repeating' | 'forever'
  duration_in_months?: number
  name: string
  metadata: Record<string, string>
}

export function couponSpecs(): CouponSpec[] {
  const welcome: CouponSpec = {
    id: WELCOME_COUPON_ID,
    percent_off: 20,
    duration: 'repeating',
    duration_in_months: 2,
    name: 'Indicação: 20% nos 2 primeiros meses',
    metadata: { purpose: 'referral_welcome', app: 'floraclin' },
  }
  const referrer = REFERRER_PERCENTS.map(
    (percent, i): CouponSpec => ({
      id: REFERRER_COUPON_IDS[i],
      percent_off: percent,
      duration: 'forever',
      name: `Indique e Ganhe: ${percent}%`,
      metadata: { purpose: 'referral_reward', app: 'floraclin', percent: String(percent) },
    }),
  )
  return [welcome, ...referrer]
}

export type KeyMode = 'test' | 'live'

export function keyMode(secretKey: string): KeyMode {
  if (/^(sk|rk)_live_/.test(secretKey)) return 'live'
  if (/^(sk|rk)_test_/.test(secretKey)) return 'test'
  throw new Error('STRIPE_SECRET_KEY is not a recognised Stripe key (expected sk_/rk_ test or live)')
}

/** Throws unless allowed: live needs `--live` in argv AND no CI / VERCEL / GITHUB_ACTIONS env. */
export function assertRunAllowed(
  mode: KeyMode,
  argv: string[],
  env: Record<string, string | undefined>,
): void {
  if (mode === 'test') return
  if (!argv.includes('--live')) {
    throw new Error('Refusing to run with a live Stripe key without --live')
  }
  if (env.CI || env.VERCEL || env.GITHUB_ACTIONS) {
    throw new Error('Refusing to run in live mode under CI or Vercel')
  }
}

export interface CouponSetupDeps {
  /** null on resource_missing */
  retrieveCoupon(id: string): Promise<Stripe.Coupon | null>
  createCoupon(spec: CouponSpec): Promise<Stripe.Coupon>
  /** active, same coupon */
  findPromotionCode(couponId: string, code: string): Promise<Stripe.PromotionCode | null>
  /**
   * Creates `promotion: { type: 'coupon', coupon }`, `code`,
   * `restrictions: { first_time_transaction: true }`,
   * `metadata: { purpose: 'referral_welcome', app: 'floraclin' }`.
   */
  createPromotionCode(params: { couponId: string; code: string }): Promise<Stripe.PromotionCode>
  log(line: string): void
}

function assertSameTerms(existing: Stripe.Coupon, spec: CouponSpec): void {
  const same =
    existing.percent_off === spec.percent_off &&
    existing.duration === spec.duration &&
    (spec.duration === 'repeating'
      ? existing.duration_in_months === spec.duration_in_months
      : true)
  if (!same) throw new Error(`coupon ${spec.id} exists with different terms`)
}

export async function setupReferralCoupons(
  deps: CouponSetupDeps,
): Promise<{ promotionCodeId: string; referrerCouponIds: string[]; envLines: string[] }> {
  for (const spec of couponSpecs()) {
    const existing = await deps.retrieveCoupon(spec.id)
    if (existing) {
      assertSameTerms(existing, spec)
      deps.log(`coupon ${spec.id}: already exists, terms match`)
    } else {
      await deps.createCoupon(spec)
      deps.log(`coupon ${spec.id}: created`)
    }
  }

  let promo = await deps.findPromotionCode(WELCOME_COUPON_ID, WELCOME_PROMOTION_CODE)
  if (promo) {
    deps.log(`promotion code ${WELCOME_PROMOTION_CODE}: already exists (${promo.id})`)
  } else {
    promo = await deps.createPromotionCode({
      couponId: WELCOME_COUPON_ID,
      code: WELCOME_PROMOTION_CODE,
    })
    deps.log(`promotion code ${WELCOME_PROMOTION_CODE}: created (${promo.id})`)
  }

  const referrerCouponIds = [...REFERRER_COUPON_IDS]
  return {
    promotionCodeId: promo.id,
    referrerCouponIds,
    envLines: [
      `STRIPE_REFERRAL_PROMOTION_CODE_ID=${promo.id}`,
      `STRIPE_REFERRER_COUPON_IDS=${referrerCouponIds.join(',')}`,
    ],
  }
}

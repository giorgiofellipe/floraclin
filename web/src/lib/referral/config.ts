type Env = Record<string, string | undefined>
export type ReferrerCouponIds = Readonly<Record<20 | 40 | 60 | 80 | 100, string>>

const PERCENTS = [20, 40, 60, 80, 100] as const
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

let warnedCoupons = false

export function referralPromotionCodeId(env: Env = process.env): string | null {
  const id = env.STRIPE_REFERRAL_PROMOTION_CODE_ID?.trim()
  return id ? id : null
}

/** Exactly 5 non-empty comma-separated ids in ascending percent order; anything else is unconfigured. */
export function referrerCouponIds(env: Env = process.env): ReferrerCouponIds | null {
  const raw = env.STRIPE_REFERRER_COUPON_IDS
  if (raw === undefined || raw.trim() === '') return null
  const ids = raw.split(',').map((id) => id.trim())
  if (ids.length !== PERCENTS.length || ids.some((id) => id === '')) {
    if (!warnedCoupons) {
      warnedCoupons = true
      console.warn('[referral] STRIPE_REFERRER_COUPON_IDS must hold exactly 5 non-empty ids; rewards are off')
    }
    return null
  }
  return { 20: ids[0], 40: ids[1], 60: ids[2], 80: ids[3], 100: ids[4] }
}

/** Full ISO timestamp with offset or 'Z' only; a bare date resolves against the host clock, so it is rejected. */
export function referralRewardsEndAt(env: Env = process.env): Date | null {
  const raw = env.REFERRAL_REWARDS_END_AT?.trim()
  if (!raw) return null
  const date = ISO_WITH_OFFSET.test(raw) ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) {
    console.warn('[referral] REFERRAL_REWARDS_END_AT must be a full ISO timestamp with offset; ignoring it')
    return null
  }
  return date
}

function beforeEnd(env: Env, now: Date): boolean {
  const endAt = referralRewardsEndAt(env)
  return !endAt || now < endAt
}

/** Rewards keep syncing: coupon ids configured AND not past the end date. */
export function areReferralRewardsActive(env: Env = process.env, now: Date = new Date()): boolean {
  return referrerCouponIds(env) !== null && beforeEnd(env, now)
}

/** New activity: REFERRAL_ENROLLMENT_ENABLED === 'true' AND promo id AND coupon ids AND not past the end date. */
export function isReferralEnrollmentEnabled(env: Env = process.env, now: Date = new Date()): boolean {
  return (
    env.REFERRAL_ENROLLMENT_ENABLED === 'true' &&
    referralPromotionCodeId(env) !== null &&
    areReferralRewardsActive(env, now)
  )
}

export function couponIdForPercent(percent: number, ids: ReferrerCouponIds): string | null {
  if (percent === 20 || percent === 40 || percent === 60 || percent === 80 || percent === 100) return ids[percent]
  return null
}

/** Ours when the id is one of the five, or metadata.purpose === 'referral_reward'. */
export function isReferrerCoupon(
  coupon: { id: string; metadata?: Record<string, string> | null },
  ids: ReferrerCouponIds | null,
): boolean {
  if (coupon.metadata?.purpose === 'referral_reward') return true
  return ids !== null && Object.values(ids).includes(coupon.id)
}

/** Whether a tenant may hold an active link: paying through Stripe with an active local status. */
export function canRefer(row: { source?: string | null; status: string } | null | undefined): boolean {
  return row?.source === 'stripe' && row.status === 'active'
}

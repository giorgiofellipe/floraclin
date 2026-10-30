import {
  checkPromotionCode,
  customerHasPriorPurchase,
  getPriceInfo,
  type PriceInfo,
  type PromotionCodeTerms,
} from '@/lib/stripe'
import { reportSideEffectFailure } from '@/lib/observability'
import { feedbackIneligibility, type FeedbackEligibilityRow } from '@/lib/feedback-eligibility'
import { winbackOfferLabel } from '@/lib/winback'
import { plansCoveredBy, type WinbackPlan } from '@/lib/winback-offer'
import type { PublicFeedbackOffer } from '@/lib/feedback-offer-copy'

/**
 * Feedback reward: a trial clinic that sent us feedback gets a discount on its
 * first paid months. A platform admin flags the tenant by hand
 * (`feedback_discount_granted_at`); its next checkout then carries the
 * feedback promotion code. Like the win-back, the coupon lives in Stripe
 * (created by `scripts/create-feedback-coupon.ts`) and everything the clinic
 * reads about it comes from the coupon once Stripe validates it. Nothing is
 * offered until the promotion code id is configured, so deploying this
 * changes nothing by itself.
 *
 *   STRIPE_FEEDBACK_PROMOTION_CODE_ID  promo_... (required to enable the offer)
 */

export interface ValidatedFeedbackOffer extends PublicFeedbackOffer {
  promotionCodeId: string
}

export interface FeedbackRow extends FeedbackEligibilityRow {
  tenantId?: string
  stripeCustomerId?: string | null
  feedbackDiscountGrantedAt?: Date | string | null
}

export interface FeedbackDeps {
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null>
  priceInfo: (priceId: string, now: Date) => Promise<PriceInfo | null>
  priorPurchase: (customerId: string, now: Date) => Promise<boolean>
  report: typeof reportSideEffectFailure
}

// Built per call, not at module load: modules that only import the cheap
// checks never touch the Stripe bindings.
function stripeDeps(): FeedbackDeps {
  return {
    check: checkPromotionCode,
    priceInfo: getPriceInfo,
    priorPurchase: customerHasPriorPurchase,
    report: reportSideEffectFailure,
  }
}

export function feedbackPromotionCodeId(env: Record<string, string | undefined> = process.env): string | null {
  const id = env.STRIPE_FEEDBACK_PROMOTION_CODE_ID?.trim()
  return id ? id : null
}

/** Flagged, eligible and configured: the cheap check before any Stripe call. */
export function feedbackOfferApplies(
  row: FeedbackRow | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!feedbackPromotionCodeId(env) && !!row?.feedbackDiscountGrantedAt && feedbackIneligibility(row, now) === null
}

/**
 * The feedback offer, only when Stripe confirms the promotion code would be
 * accepted, limited to the `plans` the coupon covers, with the label and terms
 * taken from the coupon (see getValidatedWinbackOffer, which this mirrors).
 * Any failure means no offer, never a broken checkout. Everything that shows
 * or applies it (paywall, billing page, checkout) goes through this.
 */
export async function getValidatedFeedbackOffer(
  row: FeedbackRow | null | undefined,
  plans: WinbackPlan[],
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  deps: Partial<FeedbackDeps> = {},
): Promise<ValidatedFeedbackOffer | null> {
  const d: FeedbackDeps = { ...stripeDeps(), ...deps }
  if (!feedbackOfferApplies(row, now, env)) return null
  const promotionCodeId = feedbackPromotionCodeId(env)!
  const sellable = plans.filter((p): p is WinbackPlan & { stripePriceId: string } => !!p.stripePriceId)
  if (sellable.length === 0) return null

  try {
    const terms = await d.check(promotionCodeId, now)
    if (!terms) return null
    const customerId = row?.stripeCustomerId
    if (terms.firstTimeTransaction && customerId && (await d.priorPurchase(customerId, now))) return null

    const covered = await plansCoveredBy(terms, sellable, now, d.priceInfo)
    if (covered.length === 0) return null

    return {
      kind: 'feedback',
      promotionCodeId,
      label: winbackOfferLabel(
        terms,
        covered.map((p) => p.name),
        covered.length === sellable.length,
      ),
      percentOff: terms.percentOff,
      amountOffCents: terms.amountOffCents,
      duration: terms.duration,
      durationInMonths: terms.durationInMonths,
      planSlugs: covered.map((p) => p.slug),
    }
  } catch (err) {
    d.report(err, { area: 'billing', step: 'feedback_offer', extra: { tenantId: row?.tenantId, promotionCodeId } })
    return null
  }
}

/** The client-safe part of the offer: the promotion code id stays server-side. */
export function publicFeedbackOffer(o: ValidatedFeedbackOffer | null): PublicFeedbackOffer | null {
  if (!o) return null
  return {
    kind: 'feedback',
    label: o.label,
    percentOff: o.percentOff,
    amountOffCents: o.amountOffCents,
    duration: o.duration,
    durationInMonths: o.durationInMonths,
    planSlugs: o.planSlugs,
  }
}

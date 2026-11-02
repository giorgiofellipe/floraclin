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
import { FEEDBACK_COUPON_SPEC } from '@/lib/feedback-coupon-setup'

/**
 * Feedback reward: a platform admin flags a trial clinic that sent feedback
 * (`feedback_discount_granted_at`) and its next checkout carries the feedback
 * promotion code (STRIPE_FEEDBACK_PROMOTION_CODE_ID).
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

const STRIPE_DEPS: FeedbackDeps = {
  check: checkPromotionCode,
  priceInfo: getPriceInfo,
  priorPurchase: customerHasPriorPurchase,
  report: reportSideEffectFailure,
}

export function feedbackPromotionCodeId(env: Record<string, string | undefined> = process.env): string | null {
  const id = env.STRIPE_FEEDBACK_PROMOTION_CODE_ID?.trim()
  return id ? id : null
}

function flaggedAndEligible(row: FeedbackRow | null | undefined, now: Date): boolean {
  return !!row?.feedbackDiscountGrantedAt && feedbackIneligibility(row, now) === null
}

/** Flagged, eligible and configured: the cheap check before any Stripe call. */
export function feedbackOfferApplies(
  row: FeedbackRow | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!feedbackPromotionCodeId(env) && flaggedAndEligible(row, now)
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
  const promotionCodeId = feedbackPromotionCodeId(env)
  if (!promotionCodeId || !flaggedAndEligible(row, now)) return null
  const d: FeedbackDeps = { ...STRIPE_DEPS, ...deps }
  const sellable = plans.filter((p): p is WinbackPlan & { stripePriceId: string } => !!p.stripePriceId)
  if (sellable.length === 0) return null

  try {
    const terms = await d.check(promotionCodeId, now)
    if (!terms) return null
    if (!matchesFeedbackTerms(terms)) {
      if (!reportedMisconfigured.has(promotionCodeId)) {
        reportedMisconfigured.add(promotionCodeId)
        d.report(new Error('Feedback promotion code does not match the feedback coupon spec'), {
          area: 'billing',
          step: 'feedback_promo_misconfigured',
          extra: { promotionCodeId, terms },
        })
      }
      return null
    }
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

// The layout looks the offer up on every render; one report per code and server instance is enough.
const reportedMisconfigured = new Set<string>()

/** The admin screen and the copy promise FEEDBACK_COUPON_SPEC; any other coupon behind the env id is a misconfiguration. */
function matchesFeedbackTerms(terms: PromotionCodeTerms): boolean {
  return (
    terms.percentOff === FEEDBACK_COUPON_SPEC.percent_off &&
    terms.duration === FEEDBACK_COUPON_SPEC.duration &&
    terms.durationInMonths === FEEDBACK_COUPON_SPEC.duration_in_months &&
    terms.firstTimeTransaction
  )
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

import {
  checkPromotionCode,
  customerHasPriorPurchase,
  getPriceInfo,
  type PriceInfo,
  type PromotionCodeTerms,
} from '@/lib/stripe'
import { getTrialUsage } from '@/db/queries/trial-recap'
import { usedTrial } from '@/lib/trial-recap'
import { getWinbackOffer, winbackOfferLabel, type ValidatedWinbackOffer, type WinbackRow } from '@/lib/winback'

/** A plan on sale, as far as the offer cares. */
export interface WinbackPlan {
  slug: string
  name: string
  priceCents: number
  stripePriceId: string | null
}

export interface WinbackDeps {
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null>
  priceInfo: (priceId: string, now: Date) => Promise<PriceInfo | null>
  priorPurchase: (customerId: string, now: Date) => Promise<boolean>
  /** Patient + appointment, not deleted: the same rule as the win-back email. */
  usedTrial: (tenantId: string) => Promise<boolean>
}

const STRIPE_DEPS: WinbackDeps = {
  check: checkPromotionCode,
  priceInfo: getPriceInfo,
  priorPurchase: customerHasPriorPurchase,
  usedTrial: async (tenantId) => usedTrial(await getTrialUsage(tenantId)),
}

/**
 * The win-back offer, only when Stripe confirms the promotion code would be
 * accepted (see `checkPromotionCode`), limited to the `plans` the coupon's
 * `applies_to` covers and whose price meets the code's `minimum_amount`,
 * with the label and terms taken from the coupon. With
 * `first_time_transaction`, a clinic whose Stripe customer has ever paid or
 * subscribed gets nothing. Our row rules that out for free: checkout makes a
 * fresh Stripe customer each time and only a completed one is stored, which
 * also moves the row off `trial`. Stripe is asked only if a `trial` row ever
 * carries a customer id (defence in depth; not expected today). Only for a
 * clinic that used the trial (a patient and an appointment, not deleted):
 * the discount is there to bring back clinics that got going, so a clinic
 * that never started sees full prices everywhere, checkout included.
 * Everything that shows or applies the offer (paywall, checkout, win-back
 * emails) goes through this, so a clinic is never promised a discount
 * checkout would drop. Null when no plan is covered.
 */
export async function getValidatedWinbackOffer(
  row: WinbackRow | null | undefined,
  plans: WinbackPlan[],
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  deps: WinbackDeps = STRIPE_DEPS,
): Promise<ValidatedWinbackOffer | null> {
  const offer = getWinbackOffer(row, now, env)
  if (!offer) return null
  if (!row?.tenantId || !(await deps.usedTrial(row.tenantId))) return null
  const sellable = plans.filter((p): p is WinbackPlan & { stripePriceId: string } => !!p.stripePriceId)
  if (sellable.length === 0) return null
  const terms = await deps.check(offer.promotionCodeId, now)
  if (!terms) return null
  const customerId = row?.stripeCustomerId
  if (terms.firstTimeTransaction && customerId && (await deps.priorPurchase(customerId, now))) return null

  const covered = await plansCoveredBy(terms, sellable, now, deps.priceInfo)
  if (covered.length === 0) return null

  return {
    ...offer,
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
}

/**
 * The plans a promotion code would discount at checkout: those whose Stripe
 * product the coupon's `applies_to` covers and whose price meets the code's
 * `minimum_amount`. A plan whose price lookup failed counts as not covered.
 * Shared by every offer that attaches a promotion code (win-back, feedback).
 */
export async function plansCoveredBy<P extends { stripePriceId: string }>(
  terms: PromotionCodeTerms,
  sellable: P[],
  now: Date,
  priceInfo: WinbackDeps['priceInfo'],
): Promise<P[]> {
  const minimum = terms.minimumAmountCents
  const restrictTo = terms.productIds
  const covers = await Promise.all(
    sellable.map(async (plan): Promise<boolean> => {
      if (!restrictTo && minimum == null) return true
      const info = await priceInfo(plan.stripePriceId, now)
      if (!info) return false
      // Stripe checks the minimum against its price before the discount; a
      // price with no fixed BRL amount cannot be shown to meet it.
      if (minimum != null && (info.unitAmountCents == null || info.unitAmountCents < minimum)) return false
      return !restrictTo || restrictTo.includes(info.productId)
    }),
  )
  return sellable.filter((_, i) => covers[i])
}

import { checkPromotionCode, getPriceProductId, type PromotionCodeTerms } from '@/lib/stripe'
import { getWinbackOffer, winbackOfferLabel, type ValidatedWinbackOffer, type WinbackRow } from '@/lib/winback'

/** A plan on sale, as far as the offer cares. */
export interface WinbackPlan {
  slug: string
  name: string
  stripePriceId: string | null
}

export interface WinbackDeps {
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null>
  priceProduct: (priceId: string, now: Date) => Promise<string | null>
}

const STRIPE_DEPS: WinbackDeps = { check: checkPromotionCode, priceProduct: getPriceProductId }

/**
 * The win-back offer, only when Stripe confirms the promotion code would be
 * accepted (see `checkPromotionCode`), limited to the `plans` the coupon's
 * `applies_to` covers, with the label and terms taken from the coupon.
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
  const sellable = plans.filter((p): p is WinbackPlan & { stripePriceId: string } => !!p.stripePriceId)
  if (sellable.length === 0) return null
  const terms = await deps.check(offer.promotionCodeId, now)
  if (!terms) return null

  const restrictTo = terms.productIds
  const covered = restrictTo
    ? (
        await Promise.all(
          sellable.map(async (plan) => {
            const productId = await deps.priceProduct(plan.stripePriceId, now)
            return productId && restrictTo.includes(productId) ? plan : null
          }),
        )
      ).filter((p): p is (typeof sellable)[number] => p !== null)
    : sellable
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

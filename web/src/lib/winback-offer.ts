import { checkPromotionCode, type PromotionCodeTerms } from '@/lib/stripe'
import { getWinbackOffer, type WinbackOffer, type WinbackRow } from '@/lib/winback'

/**
 * The win-back offer, only when Stripe confirms the promotion code would be
 * accepted (see `checkPromotionCode`), with the coupon's terms so the paywall
 * can show the discounted price. Everything that shows or applies the offer
 * (paywall, checkout, win-back emails) goes through this, so a clinic is
 * never promised a discount checkout would drop.
 */
export async function getValidatedWinbackOffer(
  row: WinbackRow | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null> = checkPromotionCode,
): Promise<WinbackOffer | null> {
  const offer = getWinbackOffer(row, now, env)
  if (!offer) return null
  const terms = await check(offer.promotionCodeId, now)
  return terms ? { ...offer, ...terms } : null
}

import { addDays } from 'date-fns'
import { effectiveSubscriptionStatus, type SubscriptionAccessRow } from '@/lib/subscription-access'

/**
 * Win-back offer for clinics whose free trial ended without paying.
 *
 * The discount itself lives in Stripe (a coupon plus a promotion code created
 * there by hand); the app only decides who is eligible and attaches that
 * promotion code to their Checkout Session. Nothing is offered until the
 * promotion code id is configured, so deploying this changes nothing by
 * itself.
 *
 *   STRIPE_WINBACK_PROMOTION_CODE_ID  promo_... (required to enable the offer)
 *   WINBACK_OFFER_LABEL               pt-BR copy shown on the paywall, e.g.
 *                                     "30% de desconto nos 3 primeiros meses".
 *                                     Must match the Stripe coupon.
 *   WINBACK_OFFER_DAYS                days after the trial end the offer stays
 *                                     open (default 14)
 */
export interface WinbackOffer {
  promotionCodeId: string
  label: string
  endsAt: string
  /** From the Stripe coupon, once validated (see getValidatedWinbackOffer). */
  percentOff?: number | null
  durationInMonths?: number | null
}

/** What reaches the client: no promotion code id. */
export interface PublicWinbackOffer {
  label: string
  endsAt: string
  percentOff?: number | null
  durationInMonths?: number | null
}

const DEFAULT_LABEL = 'Desconto especial na primeira assinatura'
const DEFAULT_DAYS = 14

export interface WinbackRow extends SubscriptionAccessRow {
  firstPaidAt?: Date | string | null
}

export function getWinbackOffer(
  row: WinbackRow | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): WinbackOffer | null {
  const promotionCodeId = env.STRIPE_WINBACK_PROMOTION_CODE_ID?.trim()
  if (!promotionCodeId || !row) return null
  // Only a trial that ran out, never someone who has paid before or lost a
  // gift: the offer is there to convert, not to discount existing customers.
  if (row.source !== 'trial' || row.firstPaidAt || row.stripeSubscriptionId) return null
  if (effectiveSubscriptionStatus(row, now) !== 'expired' || !row.currentPeriodEnd) return null

  const parsedDays = Number.parseInt(env.WINBACK_OFFER_DAYS ?? '', 10)
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : DEFAULT_DAYS
  const endsAt = addDays(new Date(row.currentPeriodEnd), days)
  if (now.getTime() > endsAt.getTime()) return null

  return {
    promotionCodeId,
    label: env.WINBACK_OFFER_LABEL?.trim() || DEFAULT_LABEL,
    endsAt: endsAt.toISOString(),
  }
}

/** The client-safe part of the offer: the promotion code id stays server-side. */
export function publicWinbackOffer(offer: WinbackOffer | null): PublicWinbackOffer | null {
  if (!offer) return null
  return {
    label: offer.label,
    endsAt: offer.endsAt,
    percentOff: offer.percentOff ?? null,
    durationInMonths: offer.durationInMonths ?? null,
  }
}

import { effectiveSubscriptionStatus, type SubscriptionAccessRow } from '@/lib/subscription-access'
import { endOfBrDay, shiftBrYmd, toBrYmd } from '@/lib/dates'
import type { PromotionCodeTerms } from '@/lib/stripe'

/**
 * Win-back offer for clinics whose free trial ended without paying.
 *
 * The discount itself lives in Stripe (a coupon plus a promotion code created
 * there by hand); the app only decides who is eligible and attaches that
 * promotion code to their Checkout Session. Everything the clinic reads about
 * it (label, struck-through price, which plans) comes from the coupon once
 * Stripe validates it (see getValidatedWinbackOffer). Nothing is offered
 * until the promotion code id is configured, so deploying this changes
 * nothing by itself.
 *
 *   STRIPE_WINBACK_PROMOTION_CODE_ID  promo_... (required to enable the offer)
 *   WINBACK_OFFER_DAYS                days after the trial end the offer stays
 *                                     open (default 14), until 23:59:59 BRT
 *                                     of the last day
 */
export interface WinbackOffer {
  promotionCodeId: string
  /** 23:59:59.999 America/Sao_Paulo on the last day ("até dd/MM"). */
  endsAt: string
}

/** Validated against Stripe: the coupon's terms and the plans it covers. */
export interface ValidatedWinbackOffer extends WinbackOffer {
  label: string
  percentOff: number | null
  amountOffCents: number | null
  duration: PromotionCodeTerms['duration']
  durationInMonths: number | null
  /** Plans whose Stripe product the coupon applies to; never empty. */
  planSlugs: string[]
}

/** What reaches the client: no promotion code id. */
export type PublicWinbackOffer = Omit<ValidatedWinbackOffer, 'promotionCodeId'>

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
  // The whole last day, in the clinic's time zone: the copy says "até dd/MM".
  const endsAt = endOfBrDay(shiftBrYmd(toBrYmd(new Date(row.currentPeriodEnd)), days))
  if (now.getTime() > endsAt.getTime()) return null

  return { promotionCodeId, endsAt: endsAt.toISOString() }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function durationPhrase(terms: Pick<PromotionCodeTerms, 'duration' | 'durationInMonths'>): string {
  if (terms.duration === 'forever') return ' em todas as mensalidades'
  if (terms.duration === 'once') return ' na primeira mensalidade'
  if (terms.durationInMonths === 1) return ' no primeiro mês'
  if (terms.durationInMonths) return ` nos ${terms.durationInMonths} primeiros meses`
  return ''
}

function planScope(planNames: string[]): string {
  if (planNames.length === 0) return ''
  if (planNames.length === 1) return ` no plano ${planNames[0]}`
  return ` nos planos ${planNames.slice(0, -1).join(', ')} e ${planNames[planNames.length - 1]}`
}

/**
 * The offer in words, from the coupon itself: "30% de desconto nos 3
 * primeiros meses", "R$ 50,00 de desconto na primeira mensalidade". When the
 * coupon covers only some of the plans on sale, it says which
 * ("… no plano Pro").
 */
export function winbackOfferLabel(
  terms: Pick<PromotionCodeTerms, 'percentOff' | 'amountOffCents' | 'duration' | 'durationInMonths'>,
  coveredPlanNames: string[] = [],
  allPlansCovered = true,
): string {
  const amount = terms.percentOff
    ? `${terms.percentOff}% de desconto`
    : `${BRL.format((terms.amountOffCents ?? 0) / 100)} de desconto`
  return `${amount}${durationPhrase(terms)}${allPlansCovered ? '' : planScope(coveredPlanNames)}`
}

/** The client-safe part of the offer: the promotion code id stays server-side. */
export function publicWinbackOffer(offer: ValidatedWinbackOffer | null): PublicWinbackOffer | null {
  if (!offer) return null
  return {
    label: offer.label,
    endsAt: offer.endsAt,
    percentOff: offer.percentOff,
    amountOffCents: offer.amountOffCents,
    duration: offer.duration,
    durationInMonths: offer.durationInMonths,
    planSlugs: offer.planSlugs,
  }
}

/** The price a plan shows under the offer, or null when the offer does not
 *  cover it. Rounded to the cent like Stripe does. */
export function winbackPriceCents(
  plan: { slug: string; priceCents: number },
  offer: Pick<PublicWinbackOffer, 'percentOff' | 'amountOffCents' | 'planSlugs'> | null,
): number | null {
  if (!offer || !offer.planSlugs.includes(plan.slug)) return null
  // Stripe rounds the discount, then subtracts it.
  if (offer.percentOff) return plan.priceCents - Math.round((plan.priceCents * offer.percentOff) / 100)
  if (offer.amountOffCents) return Math.max(0, plan.priceCents - offer.amountOffCents)
  return null
}

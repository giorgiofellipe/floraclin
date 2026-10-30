import {
  getReferralAttribution,
  loadCandidateTenants,
  loadTenantSignals,
  markReferralIneligible,
} from '@/db/queries/referrals'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { reportSideEffectFailure } from '@/lib/observability'
import { checkPromotionCode, customerHasPriorPurchase, type PromotionCodeTerms } from '@/lib/stripe'
import { winbackOfferLabel } from '@/lib/winback'
import { isReferralEnrollmentEnabled, referralPromotionCodeId } from './config'
import { runEligibilityChecks } from './eligibility'
import { announceReferralStatusChange } from './announce'
import type { PublicReferralOffer } from './offer-copy'
import { REFERRAL_WELCOME_MONTHS, REFERRAL_WELCOME_PERCENT, isReferralEligiblePlan } from './rules'

export interface ReferralOfferRow {
  tenantId: string
  source?: string | null
  firstPaidAt?: Date | string | null
  stripeSubscriptionId?: string | null
  stripeCustomerId?: string | null
}

export interface ReferralOfferPlan {
  slug: string
  name: string
  priceCents: number
  billingInterval: string
  stripePriceId: string | null
}

export interface ValidatedReferralOffer extends PublicReferralOffer {
  promotionCodeId: string
  referralId: string
}

type Attribution = Awaited<ReturnType<typeof getReferralAttribution>>

export interface ReferralOfferDeps {
  attribution(tenantId: string): Promise<Attribution>
  signupAt(tenantId: string): Promise<Date>
  runChecks: typeof runEligibilityChecks
  loadSignals: typeof loadTenantSignals
  loadCandidates: typeof loadCandidateTenants
  markIneligible: typeof markReferralIneligible
  announce: typeof announceReferralStatusChange
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null>
  priorPurchase: (customerId: string, now: Date) => Promise<boolean>
  report: typeof reportSideEffectFailure
}

const PRODUCTION_DEPS: ReferralOfferDeps = {
  attribution: getReferralAttribution,
  signupAt: async (tenantId) => {
    const [row] = await db.select({ createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!row) throw new Error(`Tenant not found: ${tenantId}`)
    return row.createdAt
  },
  runChecks: runEligibilityChecks,
  loadSignals: loadTenantSignals,
  loadCandidates: loadCandidateTenants,
  markIneligible: markReferralIneligible,
  announce: announceReferralStatusChange,
  check: checkPromotionCode,
  priorPurchase: customerHasPriorPurchase,
  report: reportSideEffectFailure,
}

/**
 * The referral welcome coupon, only for a clinic that is still in its trial with a referral attribution that
 * has not been used, and only when Stripe confirms the promotion code. Everything that shows or applies the
 * offer goes through this. `opts.attribution` is a pre-fetched result so the caller reads it once.
 */
export async function getValidatedReferralOffer(
  row: ReferralOfferRow | null | undefined,
  plans: ReferralOfferPlan[],
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  deps: Partial<ReferralOfferDeps> = {},
  opts: { attribution?: Attribution } = {},
): Promise<ValidatedReferralOffer | null> {
  const d: ReferralOfferDeps = { ...PRODUCTION_DEPS, ...deps }
  if (!isReferralEnrollmentEnabled(env, now)) return null
  if (!row?.tenantId || row.firstPaidAt || row.stripeSubscriptionId) return null

  const attribution = opts.attribution !== undefined ? opts.attribution : await d.attribution(row.tenantId)
  if (!attribution || attribution.stripeSubscriptionId) return null
  if (attribution.status !== 'trial' && attribution.status !== 'trial_ended') return null

  const sellable = plans.filter(
    (p): p is ReferralOfferPlan & { stripePriceId: string } => isReferralEligiblePlan(p) && !!p.stripePriceId,
  )
  if (sellable.length === 0) return null

  // Identity re-check: a phone, owner or registry added during the trial is caught before any Stripe call.
  try {
    const res = await d.runChecks(
      {
        referredTenantId: row.tenantId,
        referrerTenantId: attribution.referrerTenantId,
        referredSignupAt: await d.signupAt(row.tenantId),
        stage: 'checkout',
      },
      { loadSignals: d.loadSignals, loadCandidates: d.loadCandidates },
    )
    if (res.verdict) {
      const updated = await d.markIneligible(attribution.id, res.verdict, undefined, { atCheckout: res })
      if (updated) {
        await d.announce(
          { ...updated, status: attribution.status, pausedReason: null, ineligibleReason: null },
          updated,
        )
      }
      return null
    }
  } catch (err) {
    d.report(err, { area: 'referral', step: 'offer_checks', extra: { referralId: attribution.id } })
    return null
  }

  const promotionCodeId = referralPromotionCodeId(env)
  if (!promotionCodeId) return null
  const terms = await d.check(promotionCodeId, now)
  if (!terms) return null
  if (!matchesWelcomeTerms(terms)) {
    d.report(new Error('Referral promotion code does not match the advertised welcome offer'), {
      area: 'referral',
      step: 'referral_promo_misconfigured',
      extra: { promotionCodeId, terms },
    })
    return null
  }
  if (terms.firstTimeTransaction && row.stripeCustomerId && (await d.priorPurchase(row.stripeCustomerId, now))) {
    return null
  }

  return {
    kind: 'referral',
    referrerName: attribution.referrerName,
    label: winbackOfferLabel(terms),
    percentOff: terms.percentOff,
    amountOffCents: terms.amountOffCents,
    duration: terms.duration,
    durationInMonths: terms.durationInMonths,
    planSlugs: sellable.map((p) => p.slug),
    promotionCodeId,
    referralId: attribution.id,
  }
}

/** The site and the signup copy promise exactly this; any other coupon behind the env id is a misconfiguration. */
function matchesWelcomeTerms(terms: PromotionCodeTerms): boolean {
  return (
    terms.productIds === null &&
    terms.percentOff === REFERRAL_WELCOME_PERCENT &&
    terms.amountOffCents === null &&
    terms.duration === 'repeating' &&
    terms.durationInMonths === REFERRAL_WELCOME_MONTHS &&
    terms.firstTimeTransaction
  )
}

/** The client-safe part of the offer: the promotion code id stays server-side. */
export function publicReferralOffer(o: ValidatedReferralOffer | null): PublicReferralOffer | null {
  if (!o) return null
  return {
    kind: 'referral',
    referrerName: o.referrerName,
    label: o.label,
    percentOff: o.percentOff,
    amountOffCents: o.amountOffCents,
    duration: o.duration,
    durationInMonths: o.durationInMonths,
    planSlugs: o.planSlugs,
  }
}

export type CheckoutDiscountChoice =
  | { kind: 'feedback'; promotionCodeId: string }
  | { kind: 'winback'; promotionCodeId: string }
  | { kind: 'referral'; promotionCodeId: string }
  | { kind: null; promotionCodeId: null }

type Offer = { promotionCodeId: string } | null

/** Exactly one coupon: the feedback reward, then VOLTA30, then the referral welcome. */
export function chooseCheckoutDiscount(offers: { feedback?: Offer; winback: Offer; referral: Offer }): CheckoutDiscountChoice {
  if (offers.feedback) return { kind: 'feedback', promotionCodeId: offers.feedback.promotionCodeId }
  if (offers.winback) return { kind: 'winback', promotionCodeId: offers.winback.promotionCodeId }
  if (offers.referral) return { kind: 'referral', promotionCodeId: offers.referral.promotionCodeId }
  return { kind: null, promotionCodeId: null }
}

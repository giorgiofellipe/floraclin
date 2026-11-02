import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthContext } from '@/lib/auth'
import { getSubscription, listPlans } from '@/db/queries/subscriptions'
import { effectiveSubscriptionStatus } from '@/lib/subscription-access'
import { db } from '@/db/client'
import { tenantUsers, patients } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'
import { handleApiError } from '@/lib/api-error'
import { getSubscriptionDiscount } from '@/lib/stripe'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { getReferralAttribution } from '@/db/queries/referrals'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { REFERRAL_COOKIE_NAME, normalizeReferralCode } from '@/lib/referral/rules'
import { getValidatedReferralOffer, publicReferralOffer } from '@/lib/referral/offer'
import { referralOfferHeadline, type PublicReferralOffer } from '@/lib/referral/offer-copy'
import { feedbackOfferApplies, getValidatedFeedbackOffer, publicFeedbackOffer } from '@/lib/feedback-offer'
import { feedbackOfferHeadline, type PublicFeedbackOffer } from '@/lib/feedback-offer-copy'
import { sellablePlans } from '@/lib/plan-benefits'
import { pickOffers } from '@/lib/paywall-offers'

type PlanLimits = Record<string, number>
type BillingOffer = (PublicFeedbackOffer | PublicReferralOffer) & { headline: string }

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const subscription = await getSubscription(ctx.tenantId)
    if (!subscription) {
      return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
    }

    const limits = (subscription.plan.limits ?? {}) as PlanLimits

    const [usersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.tenantId, ctx.tenantId),
          eq(tenantUsers.isActive, true)
        )
      )

    const [patientsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, ctx.tenantId),
          isNull(patients.deletedAt)
        )
      )

    const status = effectiveSubscriptionStatus(subscription) ?? subscription.status
    // A coupon on the Stripe subscription (the win-back offer): the page shows
    // what the clinic actually pays and until when. Only for a live Stripe
    // subscription; cached in getSubscriptionDiscount.
    const discountP =
      subscription.source === 'stripe' &&
      subscription.stripeSubscriptionId &&
      (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled')
        ? getSubscriptionDiscount(subscription.stripeSubscriptionId, new Date(), subscription.planId)
        : Promise.resolve(null)
    const [whatsappUsage, discount] = await Promise.all([getCreditUsage(ctx.tenantId), discountP])

    // Not read at all for an unflagged clinic with the referral switch off.
    const referralEnabled = isReferralEnrollmentEnabled()
    const flagged = feedbackOfferApplies(subscription)
    const plans = flagged || referralEnabled ? sellablePlans(await listPlans(true)) : []
    const attribution = referralEnabled ? await getReferralAttribution(ctx.tenantId) : null

    // This page shows the feedback or referral offer; the win-back is looked up only because it beats the
    // referral at checkout.
    const offer = await pickOffers({
      feedback: flagged ? () => getValidatedFeedbackOffer(subscription, plans) : null,
      winback: referralEnabled ? () => getValidatedWinbackOffer(subscription, plans) : null,
      referral: referralEnabled
        ? () => getValidatedReferralOffer(subscription, plans, undefined, undefined, undefined, { attribution })
        : null,
    })
    let billingOffer: BillingOffer | null = null
    if (offer?.kind === 'feedback') {
      const shown = publicFeedbackOffer(offer)!
      billingOffer = { ...shown, headline: feedbackOfferHeadline(shown) }
    } else if (offer?.kind === 'referral') {
      const shown = publicReferralOffer(offer)!
      billingOffer = { ...shown, headline: referralOfferHeadline(shown) }
    }

    let referral: { canEnterCode: boolean; linkCode: string | null } = { canEnterCode: false, linkCode: null }
    if (referralEnabled) {
      const canEnterCode =
        ctx.role === 'owner' && !subscription.firstPaidAt && !subscription.stripeSubscriptionId && !attribution
      referral = {
        canEnterCode,
        // The link cookie survives a signup whose attribution failed; it pre-fills the code field here.
        linkCode: canEnterCode ? normalizeReferralCode((await cookies()).get(REFERRAL_COOKIE_NAME)?.value) : null,
      }
    }

    return NextResponse.json({
      subscription: {
        // The effective status, so this page agrees with the gate: a trial
        // or gift past its end reads `expired` even before the 00:00 BRT
        // cron rewrites the row, and can buy its current plan again.
        status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        // Drives the billing-portal link: only after a payment, since checkout stores a customer before it.
        // A lapsed tenant keeps it, and their invoices are there.
        hasPaid: Boolean(subscription.firstPaidAt || subscription.stripeSubscriptionId),
        source: subscription.source,
      },
      plan: {
        name: subscription.plan.name,
        slug: subscription.plan.slug,
        priceCents: subscription.plan.priceCents,
        features: subscription.plan.features,
      },
      discount,
      offer: billingOffer,
      referral,
      usage: {
        users: {
          used: usersRow?.count ?? 0,
          limit: limits.users ?? 0,
        },
        patients: {
          used: patientsRow?.count ?? 0,
          limit: limits.patients ?? 0,
        },
        whatsapp: {
          used: whatsappUsage.used,
          limit: whatsappUsage.total,
          bonus: whatsappUsage.bonus,
          periodEnd: whatsappUsage.periodEnd.toISOString(),
        },
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

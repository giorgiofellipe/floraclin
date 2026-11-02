import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import {
  claimStripeCustomerId,
  getSubscription,
  getPlanBySlug,
  swapCheckoutSessionId,
  updateSubscriptionPlan,
  updateSubscriptionStatus,
} from '@/db/queries/subscriptions'
import {
  CheckoutDiscountRejectedError,
  createCheckoutSession,
  createTenantCustomer,
  expireCheckoutSession,
  updateSubscriptionPrice,
} from '@/lib/stripe'
import { handleApiError } from '@/lib/api-error'
import { cookieFromHeader, metaBrowserSignals } from '@/lib/meta/request-signals'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { getValidatedFeedbackOffer } from '@/lib/feedback-offer'
import { isStripeDriven } from '@/lib/subscription-access'
import { getReferralAttribution } from '@/db/queries/referrals'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { getValidatedReferralOffer } from '@/lib/referral/offer'
import { pickOffers } from '@/lib/paywall-offers'
import { DISCOUNT_UNAVAILABLE_CODE, DISCOUNT_UNAVAILABLE_MESSAGE } from '@/lib/billing-discount-copy'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const planSlug = body.planSlug as string | undefined

    if (!planSlug) {
      return NextResponse.json({ error: 'planSlug é obrigatório' }, { status: 400 })
    }

    const plan = await getPlanBySlug(planSlug)
    if (!plan || !plan.active) {
      return NextResponse.json({ error: 'Plano não encontrado' }, { status: 404 })
    }

    const subscription = await getSubscription(ctx.tenantId)

    // Already paying: move the existing subscription onto the new price
    // instead of opening a checkout. Checkout only ever creates a new
    // subscription, so a Starter customer picking Pro would end up billed for
    // both, and only Pro would be reachable from here afterwards.
    //
    // A cancelled subscription still counts while its period is open. It is
    // live at Stripe until then, so a checkout would run a second one
    // alongside it, and `updateSubscriptionPrice` clears
    // `cancel_at_period_end`, which is exactly what picking a plan again
    // means. Once the period closes there is nothing left to move.
    //
    // So does past_due: the charge failed but the subscription exists and
    // Stripe is retrying it. Buying again there means paying twice, once the
    // retry succeeds.
    const live =
      subscription?.status === 'active' ||
      subscription?.status === 'trialing' ||
      subscription?.status === 'past_due' ||
      (subscription?.status === 'canceled' &&
        !!subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd > new Date())

    // Only a genuine Stripe subscription can be moved to another price: a
    // gift or admin row with a leftover id points at a dead subscription.
    if (live && subscription && isStripeDriven(subscription) && subscription.stripeSubscriptionId) {
      // Same plan while a cancellation is pending is a reactivation, and
      // /api/billing/reactivate is the route that says so.
      if (subscription.planId === plan.id) {
        return NextResponse.json({ error: 'Este já é o seu plano atual' }, { status: 400 })
      }
      if (!plan.stripePriceId) {
        return NextResponse.json({ error: 'Plano sem preço configurado' }, { status: 400 })
      }

      const updated = await updateSubscriptionPrice(subscription.stripeSubscriptionId, plan.stripePriceId)

      await updateSubscriptionPlan(ctx.tenantId, plan.id, 'stripe', {
        // A switch does not settle an unpaid invoice. Claiming 'active' here
        // would unblock a tenant Stripe is still retrying; the webhook says
        // when that clears.
        status: subscription.status === 'past_due' ? 'past_due' : 'active',
        stripeSubscriptionId: updated.id,
      })

      // Switching off a pending cancellation resumes the subscription, so the
      // row must stop claiming it is on its way out.
      if (subscription.status === 'canceled') {
        await updateSubscriptionStatus(ctx.tenantId, 'active', { canceledAt: null })
      }

      return NextResponse.json({ url: null, updated: true })
    }

    // Decided from the stored row, never from the client, and only for a coupon that covers this plan.
    const attribution = isReferralEnrollmentEnabled() ? await getReferralAttribution(ctx.tenantId) : null
    const offer = await pickOffers({
      feedback: () => getValidatedFeedbackOffer(subscription, [plan]),
      winback: () => getValidatedWinbackOffer(subscription, [plan]),
      referral: attribution
        ? () => getValidatedReferralOffer(subscription ?? null, [plan], undefined, undefined, undefined, { attribution })
        : null,
    })

    // One Stripe customer per clinic, stored before any session: a first-time-only code then works once per
    // clinic, not once per checkout tab.
    const customerId =
      subscription?.stripeCustomerId ??
      (await claimStripeCustomerId(ctx.tenantId, await createTenantCustomer(ctx.tenantId)))
    if (!customerId) {
      return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
    }

    let session: { sessionId: string; url: string }
    try {
      session = await createCheckoutSession(ctx.tenantId, planSlug, customerId, {
        promotionCodeId: offer?.promotionCodeId ?? null,
        discountKind: offer?.kind,
        referralId: attribution?.id ?? null,
        browser: metaBrowserSignals(request.headers, cookieFromHeader(request.headers)),
      })
    } catch (err) {
      if (!(err instanceof CheckoutDiscountRejectedError)) throw err
      return NextResponse.json({ error: DISCOUNT_UNAVAILABLE_MESSAGE, code: DISCOUNT_UNAVAILABLE_CODE }, { status: 409 })
    }

    // One open session per clinic: the one it replaces may carry other terms.
    const previous = await swapCheckoutSessionId(ctx.tenantId, session.sessionId)
    if (previous && previous !== session.sessionId) await expireCheckoutSession(previous)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    return handleApiError(error, request)
  }
}

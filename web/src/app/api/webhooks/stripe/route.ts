import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { db } from '@/db/client'
import { tenantSubscriptions, plans } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { constructWebhookEvent, retrieveSubscription, subscriptionPeriod } from '@/lib/stripe'
import {
  getPlanBySlug,
  updateSubscriptionPlan,
  updateSubscriptionPeriod,
  updateSubscriptionStatus,
  type SubscriptionStatus,
} from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(body, signature)
  } catch (err) {
    // A rotated STRIPE_WEBHOOK_SECRET drops every billing event, and the 400
    // is invisible from our side: Stripe retries, gives up, and the first
    // symptom is a subscription that silently stopped updating.
    //
    // Only when a signature was actually presented, though. This endpoint is
    // public, and a scanner posting to it carries no `stripe-signature`
    // header at all; reporting those would be reporting the internet.
    if (signature) {
      reportSideEffectFailure(err, { area: 'billing', step: 'stripe_signature' })
    }
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
    }
  } catch (err) {
    return handleApiError(err, request, { body: { error: 'Webhook handler failed' } })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId
  const planSlug = session.metadata?.planSlug
  if (!tenantId || !planSlug) return

  const plan = await getPlanBySlug(planSlug)
  if (!plan || !plan.active) return

  // The same replay guard /api/billing/confirm carries. A signed
  // checkout.session.completed stays valid and replayable forever, and Stripe
  // itself will resend one after a delivery failure. Without these, an event
  // that arrives after the customer cancelled overwrites `canceled` with
  // `active` and hands back access they stopped paying for.
  if (session.payment_status !== 'paid') return

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id
  const stripeSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id

  // Unlike the confirm route we cannot expand the subscription here, since
  // the payload is whatever Stripe signed. Ask Stripe for its current state
  // rather than trusting a snapshot that may be days old.
  // A failure here propagates on purpose: answering 200 tells Stripe the
  // event is handled and stops the redelivery, so swallowing a transient
  // outage would cost this customer the subscription they just paid for.
  let period: { currentPeriodStart: Date; currentPeriodEnd: Date } | null = null

  if (stripeSubscriptionId) {
    const current = await retrieveSubscription(stripeSubscriptionId)
    if (current.status !== 'active' && current.status !== 'trialing') return
    if (current.cancel_at_period_end) return
    // Written here rather than left for invoice.paid. A tenant buying after
    // their trial lapsed would otherwise keep the expired boundary until that
    // event happens to arrive, and read as lapsed in the meantime.
    period = subscriptionPeriod(current)
  }

  await updateSubscriptionPlan(tenantId, plan.id, 'stripe', {
    status: 'active',
    stripeCustomerId: stripeCustomerId ?? undefined,
    stripeSubscriptionId: stripeSubscriptionId ?? undefined,
    ...(period ?? {}),
  })
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = extractSubscriptionId(invoice)
  if (!stripeSubscriptionId) return

  const sub = await findSubscriptionByStripeId(stripeSubscriptionId)
  if (!sub) return

  // Both the period and the status come from the subscription. The invoice
  // is only the trigger: its first line can be a proration covering the tail
  // of the previous cycle, and writing `active` from the event alone
  // resurrected cancelled subscriptions whenever an old paid invoice arrived
  // late.
  const current = await retrieveSubscription(stripeSubscriptionId)
  await syncPeriodFromStripe(current, sub)
  await syncStatusFromStripe(current, sub)
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = extractSubscriptionId(invoice)
  if (!stripeSubscriptionId) return

  const sub = await findSubscriptionByStripeId(stripeSubscriptionId)
  if (!sub) return

  const current = await retrieveSubscription(stripeSubscriptionId)
  await syncStatusFromStripe(current, sub)
}

/**
 * Our status for a Stripe one, or null when Stripe reports something we have
 * no name for.
 *
 * A pending cancellation reads as `canceled` even though Stripe still says
 * `active`, matching what our own cancel route writes: the row means "on its
 * way out", and `isSubscriptionActive` keeps honouring the paid period for
 * it. `unpaid` is Stripe having given up retrying, which is the same thing to
 * us as a failed charge, and the period check decides when access stops.
 *
 * `paused` is Stripe not collecting: a trial that ends with no payment
 * method lands there. Holding our `trialing` would be the worst answer,
 * because trialing access ignores the period end entirely and would never
 * lapse. `past_due` stops at the period end and reads correctly in the UI.
 *
 * `incomplete` returns null and the row is left alone: that is a checkout
 * still in flight, not a state to act on.
 */
function localStatus(subscription: Stripe.Subscription): SubscriptionStatus | null {
  switch (subscription.status) {
    case 'active':
      return subscription.cancel_at_period_end ? 'canceled' : 'active'
    case 'trialing':
      return subscription.cancel_at_period_end ? 'canceled' : 'trialing'
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    default:
      return null
  }
}

/**
 * Writes the status Stripe reports right now, not the one the event carried.
 *
 * Stripe does not guarantee delivery order, and every payload is a snapshot
 * of the moment it was created. Applying snapshots meant a late `invoice.paid`
 * could flip a cancelled subscription back to `active`, and `active` ignores
 * `currentPeriodEnd`, so that access never lapsed again. Re-reading makes
 * ordering irrelevant: whatever arrives, we ask the source.
 *
 * `retrieveSubscription` is allowed to throw. Answering 200 would tell Stripe
 * the event is handled and stop the redelivery.
 */
async function syncStatusFromStripe(
  current: Stripe.Subscription,
  sub: { tenantId: string; status: string; canceledAt: Date | null },
): Promise<void> {
  const status = localStatus(current)
  if (!status || status === sub.status) return

  await updateSubscriptionStatus(sub.tenantId, status, {
    canceledAt: status === 'canceled' ? (sub.canceledAt ?? new Date()) : null,
  })
}

/** Records the billing period Stripe reports, leaving the plan as it is. */
async function syncPeriodFromStripe(
  current: Stripe.Subscription,
  sub: { tenantId: string },
): Promise<void> {
  const period = subscriptionPeriod(current)
  if (!period) return

  await updateSubscriptionPeriod(sub.tenantId, period)
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const sub = await findSubscriptionByStripeId(subscription.id)
  if (!sub) return

  // Status first, and independently of the price. Anything that changes a
  // subscription without changing its plan (a cancellation, a reactivation, a
  // recovered payment) used to leave here having done nothing at all, so the
  // row only ever matched Stripe when one of our own routes had written it.
  const current = await retrieveSubscription(subscription.id)
  await syncStatusFromStripe(current, sub)
  await syncPeriodFromStripe(current, sub)

  // The price comes from the same re-read, so a stale event cannot move the
  // plan back either.
  const newPriceId = current.items?.data?.[0]?.price?.id
  if (!newPriceId) return

  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.stripePriceId, newPriceId))
    .limit(1)

  if (!plan || plan.id === sub.planId) return

  await updateSubscriptionPlan(sub.tenantId, plan.id, 'stripe')
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const sub = await findSubscriptionByStripeId(subscription.id)
  if (!sub) return

  await updateSubscriptionStatus(sub.tenantId, 'canceled', {
    canceledAt: new Date(),
  })
}

function extractSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return undefined
  return typeof sub === 'string' ? sub : sub.id
}

async function findSubscriptionByStripeId(stripeSubscriptionId: string) {
  const [row] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)

  return row ?? null
}

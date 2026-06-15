import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { db } from '@/db/client'
import { tenantSubscriptions, plans } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { constructWebhookEvent } from '@/lib/stripe'
import {
  getPlanBySlug,
  updateSubscriptionPlan,
  updateSubscriptionStatus,
} from '@/db/queries/subscriptions'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(body, signature)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
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
    console.error(`Stripe webhook error handling ${event.type}:`, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId
  const planSlug = session.metadata?.planSlug
  if (!tenantId || !planSlug) return

  const plan = await getPlanBySlug(planSlug)
  if (!plan) return

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id
  const stripeSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id

  await updateSubscriptionPlan(tenantId, plan.id, 'stripe', {
    status: 'active',
    stripeCustomerId: stripeCustomerId ?? undefined,
    stripeSubscriptionId: stripeSubscriptionId ?? undefined,
  })
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = extractSubscriptionId(invoice)
  if (!stripeSubscriptionId) return

  const sub = await findSubscriptionByStripeId(stripeSubscriptionId)
  if (!sub) return

  const lineItem = invoice.lines?.data?.[0]
  if (!lineItem?.period) return

  await updateSubscriptionPlan(sub.tenantId, sub.planId, sub.source ?? 'stripe', {
    status: 'active',
    currentPeriodStart: new Date(lineItem.period.start * 1000),
    currentPeriodEnd: new Date(lineItem.period.end * 1000),
  })
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = extractSubscriptionId(invoice)
  if (!stripeSubscriptionId) return

  const sub = await findSubscriptionByStripeId(stripeSubscriptionId)
  if (!sub) return

  await updateSubscriptionStatus(sub.tenantId, 'past_due')
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const sub = await findSubscriptionByStripeId(subscription.id)
  if (!sub) return

  const newPriceId = subscription.items?.data?.[0]?.price?.id
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

import Stripe from 'stripe'
import { db } from '@/db/client'
import { plans } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getAppUrl } from '@/lib/app-url'

let stripeClient: Stripe | null = null

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')

  stripeClient = new Stripe(key)
  return stripeClient
}

export async function createCheckoutSession(
  tenantId: string,
  planSlug: string,
  stripeCustomerId?: string | null,
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient()

  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, planSlug))
    .limit(1)

  if (!plan) throw new Error(`Plan not found: ${planSlug}`)
  if (!plan.stripePriceId) throw new Error(`Plan ${planSlug} has no Stripe price configured`)

  const appUrl = getAppUrl()

  let customer = stripeCustomerId ?? undefined
  if (!customer) {
    const created = await stripe.customers.create({
      metadata: { tenantId },
    })
    customer = created.id
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    metadata: { tenantId, planSlug },
    success_url: `${appUrl}/configuracoes?tab=assinatura&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/configuracoes?tab=assinatura`,
  })

  if (!session.url) throw new Error('Stripe Checkout session created without a URL')

  return { sessionId: session.id, url: session.url }
}

/** Reads a Checkout Session back, expanding the subscription so the caller
 *  can check its *current* state rather than trusting the session snapshot. */
export async function retrieveCheckoutSession(sessionId: string) {
  return getStripeClient().checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  })
}

/**
 * Undoes a cancellation that has not taken effect yet.
 *
 * Cancelling here is `cancel_at_period_end`, so up until the period closes
 * the subscription is still live at Stripe and the flag is just a flag.
 * Clearing it is the whole of reactivation: no new subscription, no second
 * charge, and the billing date does not move.
 */
export async function resumeStripeSubscription(stripeSubscriptionId: string) {
  const stripe = getStripeClient()
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: false,
  })
}

export async function cancelStripeSubscription(stripeSubscriptionId: string) {
  const stripe = getStripeClient()
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  })
}

/**
 * A short-lived link to Stripe's own billing management page.
 *
 * This is where a customer updates a failed card, which the app has no other
 * way to do: `past_due` told them to update their payment method and offered
 * nowhere to do it. It also carries invoice history, which clinics ask for.
 *
 * Requires the portal to be configured once in the Stripe dashboard
 * (Settings, Billing, Customer portal), or the call fails with a
 * configuration error.
 */
export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const session = await getStripeClient().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })

  return { url: session.url }
}

/**
 * The current billing period, taken from the subscription itself.
 *
 * Not from the invoice. `invoice.lines.data` is not ordered with the
 * recurring line first, and after a prorated plan switch the renewal invoice
 * also carries proration lines whose period covers the remainder of the OLD
 * cycle. Reading the first line could therefore store a boundary that has
 * already passed, which makes a paid subscription read as lapsed and lets
 * checkout open a second one alongside the live subscription.
 *
 * Reads `items.data[0]` because the period moved off the Subscription onto
 * the subscription item in this API version. One item is an invariant here:
 * `updateSubscriptionPrice` replaces the existing item rather than adding to
 * it, so a FloraClin subscription never has more than one.
 */
export function subscriptionPeriod(
  subscription: Stripe.Subscription,
): { currentPeriodStart: Date; currentPeriodEnd: Date } | null {
  const item = subscription.items.data[0]
  if (typeof item?.current_period_start !== 'number' || typeof item?.current_period_end !== 'number') {
    return null
  }

  return {
    currentPeriodStart: new Date(item.current_period_start * 1000),
    currentPeriodEnd: new Date(item.current_period_end * 1000),
  }
}

export function constructWebhookEvent(
  body: string,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set')

  return getStripeClient().webhooks.constructEvent(body, signature, secret)
}

export type CheckoutSessionCompleted = Stripe.CheckoutSessionCompletedEvent
export type InvoicePaid = Stripe.InvoicePaidEvent
export type InvoicePaymentFailed = Stripe.InvoicePaymentFailedEvent
export type CustomerSubscriptionUpdated = Stripe.CustomerSubscriptionUpdatedEvent
export type CustomerSubscriptionDeleted = Stripe.CustomerSubscriptionDeletedEvent
export type StripeWebhookEvent =
  | CheckoutSessionCompleted
  | InvoicePaid
  | InvoicePaymentFailed
  | CustomerSubscriptionUpdated
  | CustomerSubscriptionDeleted

/**
 * Current state of a subscription, straight from Stripe.
 *
 * Webhook payloads are snapshots of the moment the event was created, and a
 * signed event stays replayable indefinitely, so a delayed or resent
 * checkout.session.completed can describe a subscription that has since been
 * cancelled.
 *
 * Deliberately allowed to throw. Swallowing the failure and returning null
 * makes the caller decline to act and answer 200, which tells Stripe the
 * event was handled and stops it being redelivered: a few seconds of Stripe
 * being unreachable would cost a customer the subscription they just paid
 * for. Failing the delivery is what gets it retried.
 */
export async function retrieveSubscription(subscriptionId: string) {
  return getStripeClient().subscriptions.retrieve(subscriptionId)
}

/**
 * Moves an existing subscription onto a different price.
 *
 * Checkout always opens a NEW subscription, so sending an existing subscriber
 * through it leaves them paying for both plans on the same customer, and only
 * the newer one is reachable from our side (a tenant has a single
 * subscription row) so the older one bills forever with no way to cancel it.
 *
 * `items` carries the current line item's id: Stripe replaces a price by
 * updating that item, not by adding another one. `create_prorations` bills or
 * credits the difference for the rest of the period, which is what a customer
 * expects from an upgrade partway through a month.
 */
export async function updateSubscriptionPrice(
  stripeSubscriptionId: string,
  stripePriceId: string,
) {
  const stripe = getStripeClient()
  const current = await stripe.subscriptions.retrieve(stripeSubscriptionId)

  const [item] = current.items.data
  if (!item) throw new Error(`Subscription ${stripeSubscriptionId} has no line items`)

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: item.id, price: stripePriceId }],
    proration_behavior: 'create_prorations',
    cancel_at_period_end: false,
  })
}

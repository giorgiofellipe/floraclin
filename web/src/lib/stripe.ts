import Stripe from 'stripe'
import { db } from '@/db/client'
import { plans } from '@/db/schema'
import { eq } from 'drizzle-orm'

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set')

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

export async function cancelStripeSubscription(stripeSubscriptionId: string) {
  const stripe = getStripeClient()
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  })
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

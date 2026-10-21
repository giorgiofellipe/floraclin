import Stripe from 'stripe'
import { db } from '@/db/client'
import { plans } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getAppUrl } from '@/lib/app-url'
import { reportSideEffectFailure } from '@/lib/observability'
import type { CardSighting } from '@/lib/referral/types'

let stripeClient: Stripe | null = null

function isPromotionCodeError(err: unknown): boolean {
  if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) return false
  return (err.param ?? '').startsWith('discounts') || /promotion|coupon|discount/i.test(err.message)
}

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
  opts?: { promotionCodeId?: string | null; discountKind?: 'winback' | 'referral'; referralId?: string | null },
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

  const base: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    metadata: { tenantId, planSlug, ...(opts?.referralId ? { referralId: opts.referralId } : {}) },
    success_url: `${appUrl}/configuracoes?tab=assinatura&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/configuracoes?tab=assinatura`,
  }

  const kind = opts?.discountKind ?? 'winback'
  let session: Stripe.Checkout.Session
  if (opts?.promotionCodeId) {
    try {
      // Win-back or referral welcome: the promotion code is applied for the clinic, never typed
      // by them. Stripe rejects `discounts` together with
      // `allow_promotion_codes`, which this session does not set.
      session = await stripe.checkout.sessions.create({
        ...base,
        metadata: { ...base.metadata, [kind]: 'true' },
        discounts: [{ promotion_code: opts.promotionCodeId }],
      })
    } catch (err) {
      // An expired, exhausted or mistyped promotion code must never stop a
      // clinic from paying: report it and fall back to full price.
      // Only for errors about the discount itself: anything else (a bad
      // customer, a bad price) would fail the same way without it.
      if (!isPromotionCodeError(err)) throw err
      reportSideEffectFailure(err, { area: 'billing', step: `${kind}_discount`, extra: { tenantId, planSlug } })
      session = await stripe.checkout.sessions.create(base)
    }
  } else {
    session = await stripe.checkout.sessions.create(base)
  }

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
  opts?: { flow?: 'payment_method_update' },
): Promise<{ url: string }> {
  const session = await getStripeClient().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
    // Straight to the card form for a failed payment, instead of the portal
    // home where "update payment method" is one more click away.
    ...(opts?.flow === 'payment_method_update'
      ? { flow_data: { type: 'payment_method_update' as const } }
      : {}),
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
 * Where a Stripe subscription stands, for an admin about to reactivate our
 * row: `pending_cancel` (set to cancel at its period end; the clinic can
 * resume it in the billing portal), `live` (still billing, e.g. resumed
 * before our webhook caught up), or `ended` (Stripe will not charge again).
 * Our row reads `canceled` for all three. Throws on a Stripe error.
 */
export type StripeSubscriptionState = 'pending_cancel' | 'live' | 'ended'

export async function getStripeSubscriptionState(subscriptionId: string): Promise<StripeSubscriptionState> {
  let sub: Stripe.Subscription
  try {
    sub = await retrieveSubscription(subscriptionId)
  } catch (err) {
    // Gone at Stripe (deleted, or an id from another mode): nothing to resume.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') return 'ended'
    throw err
  }
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return 'ended'
  return sub.cancel_at_period_end ? 'pending_cancel' : 'live'
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

// ─── Referral program helpers ──────────────────────────────────────
// Thin wrappers over the Stripe API. All of them may throw: callers (webhook
// handlers, the reconcile cron) rely on a failure to get the event redelivered.

/** Upper bound for auto-paginated lists, so a runaway customer cannot loop. */
export const STRIPE_LIST_CAP = 1000

/** Retrieve that maps resource_missing to 'missing'; other errors throw. */
export async function retrieveSubscriptionOrMissing(id: string): Promise<Stripe.Subscription | 'missing'> {
  try {
    return await getStripeClient().subscriptions.retrieve(id, { expand: ['discounts.source.coupon'] })
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') return 'missing'
    throw err
  }
}

/**
 * Sets the subscription's discount list. No explicit idempotency key: the body
 * is the absolute desired list, so a repeat is naturally idempotent, while a
 * fixed key would replay a stale request for 20 → 40 → 20. The SDK's own
 * per-request retry key still covers network retries.
 */
export async function updateSubscriptionDiscounts(
  id: string,
  discounts: Stripe.SubscriptionUpdateParams.Discount[],
): Promise<Stripe.Subscription> {
  return getStripeClient().subscriptions.update(id, { discounts, proration_behavior: 'none' })
}

/** Open cycle drafts of a subscription. One page is enough: a subscription has at most one. */
export async function listOpenCycleDrafts(subscriptionId: string): Promise<Stripe.Invoice[]> {
  const list = await getStripeClient().invoices.list({
    subscription: subscriptionId,
    status: 'draft',
    limit: 5,
    expand: ['data.discounts.source.coupon'],
  })
  return list.data.filter((invoice) => invoice.billing_reason === 'subscription_cycle')
}

export async function retrieveInvoiceWithDiscounts(id: string): Promise<Stripe.Invoice> {
  return getStripeClient().invoices.retrieve(id, { expand: ['discounts.source.coupon'] })
}

/** Same rule as updateSubscriptionDiscounts: no explicit idempotency key. */
export async function updateInvoiceDiscounts(
  id: string,
  discounts: Stripe.InvoiceUpdateParams.Discount[],
): Promise<Stripe.Invoice> {
  return getStripeClient().invoices.update(id, { discounts })
}

export interface PaidInvoiceSummary {
  id: string
  billingReason: string | null
  amountPaid: number
  paidAt: Date | null
}

/** Paid invoices of a subscription, oldest first, across every page (capped). */
export async function listPaidSubscriptionInvoices(subscriptionId: string): Promise<PaidInvoiceSummary[]> {
  const invoices = await getStripeClient()
    .invoices.list({ subscription: subscriptionId, status: 'paid', limit: 100 })
    .autoPagingToArray({ limit: STRIPE_LIST_CAP })
  if (invoices.length >= STRIPE_LIST_CAP) {
    reportSideEffectFailure(new Error('Stripe list cap reached'), {
      area: 'billing',
      step: 'stripe_list_cap',
      extra: { subscriptionId, list: 'invoices' },
    })
  }
  return invoices
    .map((invoice) => {
      const paidAtSec = invoice.status_transitions?.paid_at
      return {
        id: invoice.id as string,
        billingReason: invoice.billing_reason ?? null,
        amountPaid: invoice.amount_paid,
        paidAt: paidAtSec != null ? new Date(paidAtSec * 1000) : null,
      }
    })
    .sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0))
}

/** Cards that paid for a customer, with first/last successful charge times. */
export async function listCustomerCardSightings(customerId: string): Promise<CardSighting[]> {
  const charges = await getStripeClient()
    .charges.list({ customer: customerId, limit: 100 })
    .autoPagingToArray({ limit: STRIPE_LIST_CAP })
  if (charges.length >= STRIPE_LIST_CAP) {
    reportSideEffectFailure(new Error('Stripe list cap reached'), {
      area: 'billing',
      step: 'stripe_list_cap',
      extra: { customerId, list: 'charges' },
    })
  }
  const byFingerprint = new Map<string, CardSighting>()
  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue
    const fingerprint = charge.payment_method_details?.card?.fingerprint
    if (!fingerprint) continue
    const at = new Date(charge.created * 1000)
    const seen = byFingerprint.get(fingerprint)
    if (!seen) {
      byFingerprint.set(fingerprint, { fingerprint, firstSeenAt: at, lastSeenAt: at })
    } else {
      if (at < seen.firstSeenAt) seen.firstSeenAt = at
      if (at > seen.lastSeenAt) seen.lastSeenAt = at
    }
  }
  return [...byFingerprint.values()]
}

/** The customer's earliest subscription (any status), or null. */
export async function findEarliestSubscriptionId(customerId: string): Promise<string | null> {
  const subs = await getStripeClient()
    .subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    .autoPagingToArray({ limit: STRIPE_LIST_CAP })
  let earliest: Stripe.Subscription | null = null
  for (const sub of subs) {
    if (!earliest || sub.created < earliest.created) earliest = sub
  }
  return earliest?.id ?? null
}

/** The Stripe customer behind a dispute's charge, or null when it has none. */
export async function retrieveDisputeCustomerId(dispute: Stripe.Dispute): Promise<string | null> {
  const charge =
    typeof dispute.charge === 'string' ? await getStripeClient().charges.retrieve(dispute.charge) : dispute.charge
  if (!charge) return null
  return typeof charge.customer === 'string' ? charge.customer : (charge.customer?.id ?? null)
}

// ─── Win-back promotion code check ─────────────────────────────────

const PROMO_CHECK_TTL_MS = 10 * 60 * 1000
const PROMO_CHECK_ERROR_TTL_MS = 60 * 1000

/**
 * The coupon behind a usable promotion code: everything the paywall and the
 * emails need to describe the discount and strike the price, read from Stripe
 * so the copy can never drift from what checkout applies.
 */
export interface PromotionCodeTerms {
  /** Exactly one of percentOff / amountOffCents is set. */
  percentOff: number | null
  /** BRL cents; a coupon in another currency is treated as unusable. */
  amountOffCents: number | null
  duration: 'once' | 'repeating' | 'forever'
  /** Set only when duration is `repeating`. */
  durationInMonths: number | null
  /** Products the coupon is restricted to (`applies_to`); null = every product. */
  productIds: string[] | null
  /** `restrictions.first_time_transaction`: only customers who never paid. */
  firstTimeTransaction: boolean
  /** `restrictions.minimum_amount` in BRL cents, compared with the plan price. */
  minimumAmountCents: number | null
}

const promoCheckCache = new Map<string, { terms: PromotionCodeTerms | null; until: number }>()
const priceInfoCache = new Map<string, { info: PriceInfo | null; until: number }>()
const priorPurchaseCache = new Map<string, { prior: boolean; until: number }>()

/** Test hook: the caches are module state. */
export function clearPromotionCodeCache(): void {
  promoCheckCache.clear()
  priceInfoCache.clear()
  priorPurchaseCache.clear()
}

function couponTerms(
  coupon: Stripe.Coupon,
  restrictions: Stripe.PromotionCode.Restrictions | null | undefined,
): PromotionCodeTerms | null {
  if (!coupon.valid) return null
  const percentOff = coupon.percent_off ?? null
  const amountOffCents =
    coupon.amount_off != null && (coupon.currency ?? '').toLowerCase() === 'brl' ? coupon.amount_off : null
  if (!percentOff && !amountOffCents) return null
  // A BRL currency option wins; a minimum only in another currency can never
  // be met by a BRL price, so the code is unusable here.
  const brlOption = restrictions?.currency_options?.brl?.minimum_amount
  const baseMinimum = restrictions?.minimum_amount ?? null
  const baseIsBrl = (restrictions?.minimum_amount_currency ?? '').toLowerCase() === 'brl'
  if (brlOption == null && baseMinimum != null && !baseIsBrl) return null
  const minimumAmount = brlOption ?? baseMinimum
  const duration = coupon.duration
  return {
    percentOff: percentOff || null,
    amountOffCents: percentOff ? null : amountOffCents,
    duration,
    durationInMonths: duration === 'repeating' ? (coupon.duration_in_months ?? null) : null,
    productIds: coupon.applies_to ? [...coupon.applies_to.products] : null,
    firstTimeTransaction: restrictions?.first_time_transaction === true,
    minimumAmountCents: minimumAmount,
  }
}

/**
 * The coupon terms when Stripe would accept this promotion code on a Checkout
 * Session right now (active, not past `expires_at`, redemptions left, coupon
 * still valid, a percentage or a BRL amount), else null. The paywall and the
 * win-back emails only promise a discount that passes this; which plans it
 * covers is decided from `productIds` (see `getPriceInfo`).
 *
 * Cached per server instance for 10 minutes (1 minute after a Stripe error)
 * so the platform layout does not call Stripe on every render. A Stripe
 * error counts as unusable: better to hide the offer than to promise a
 * discount checkout then drops.
 */
export async function checkPromotionCode(
  promotionCodeId: string,
  now: Date = new Date(),
): Promise<PromotionCodeTerms | null> {
  const cached = promoCheckCache.get(promotionCodeId)
  if (cached && cached.until > now.getTime()) return cached.terms

  let terms: PromotionCodeTerms | null = null
  let ttl = PROMO_CHECK_TTL_MS
  try {
    const promo = await getStripeClient().promotionCodes.retrieve(promotionCodeId, {
      // applies_to is not returned unless expanded.
      expand: ['promotion.coupon', 'promotion.coupon.applies_to'],
    })
    const coupon = promo.promotion?.coupon
    const nowSec = Math.floor(now.getTime() / 1000)
    const usable =
      promo.active &&
      (promo.expires_at == null || promo.expires_at > nowSec) &&
      (promo.max_redemptions == null || promo.times_redeemed < promo.max_redemptions) &&
      // Not expanded means Stripe did not hand it back; do not guess.
      typeof coupon === 'object' &&
      coupon !== null
    if (usable) terms = couponTerms(coupon, promo.restrictions)
  } catch (err) {
    reportSideEffectFailure(err, { area: 'billing', step: 'winback_promo_check', extra: { promotionCodeId } })
    ttl = PROMO_CHECK_ERROR_TTL_MS
  }
  promoCheckCache.set(promotionCodeId, { terms, until: now.getTime() + ttl })
  return terms
}

/** What the win-back check needs from a Stripe price. */
export interface PriceInfo {
  productId: string
  /** BRL cents; null for a price in another currency or without a fixed amount. */
  unitAmountCents: number | null
}

/**
 * The Stripe product a price belongs to (to match a plan against a coupon's
 * `applies_to`) and its amount (Stripe checks a promotion code's
 * `minimum_amount` against it, not against our `plans.price_cents`). Cached
 * like the promotion check; an error returns null, so the plan counts as not
 * covered and shows its full price.
 */
export async function getPriceInfo(priceId: string, now: Date = new Date()): Promise<PriceInfo | null> {
  const cached = priceInfoCache.get(priceId)
  if (cached && cached.until > now.getTime()) return cached.info

  let info: PriceInfo | null = null
  let ttl = PROMO_CHECK_TTL_MS
  try {
    const price = await getStripeClient().prices.retrieve(priceId)
    info = {
      productId: typeof price.product === 'string' ? price.product : price.product.id,
      unitAmountCents: (price.currency ?? '').toLowerCase() === 'brl' ? (price.unit_amount ?? null) : null,
    }
  } catch (err) {
    reportSideEffectFailure(err, { area: 'billing', step: 'winback_price_product', extra: { priceId } })
    ttl = PROMO_CHECK_ERROR_TTL_MS
  }
  priceInfoCache.set(priceId, { info, until: now.getTime() + ttl })
  return info
}

/** Stripe statuses of a subscription that never actually started. */
const NEVER_STARTED: ReadonlySet<Stripe.Subscription.Status> = new Set(['incomplete', 'incomplete_expired'])

/**
 * Whether a Stripe customer has ever paid or held a subscription, i.e. would
 * fail a promotion code's `first_time_transaction` restriction. Only asked
 * for a clinic that already has a Stripe customer (one that opened checkout
 * before); our own row answers the common case (see getWinbackOffer).
 *
 * Cached like the promotion check. A Stripe error counts as "has purchased":
 * hiding the offer is better than promising a discount checkout would refuse.
 */
export async function customerHasPriorPurchase(customerId: string, now: Date = new Date()): Promise<boolean> {
  const cached = priorPurchaseCache.get(customerId)
  if (cached && cached.until > now.getTime()) return cached.prior

  let prior = true
  let ttl = PROMO_CHECK_TTL_MS
  try {
    const stripe = getStripeClient()
    // Stripe's rule is "no successful payments or invoices"; any subscription
    // that got past checkout counts too (a trial one has a paid R$ 0 invoice).
    // The 100 most recent charges: a successful one older than that also
    // left a paid invoice or a subscription, which the other two lists catch.
    const [subs, charges, invoices] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 }),
      stripe.charges.list({ customer: customerId, limit: 100 }),
      stripe.invoices.list({ customer: customerId, status: 'paid', limit: 1 }),
    ])
    prior =
      subs.data.some((sub) => !NEVER_STARTED.has(sub.status)) ||
      charges.data.some((charge) => charge.status === 'succeeded') ||
      invoices.data.length > 0
  } catch (err) {
    reportSideEffectFailure(err, { area: 'billing', step: 'winback_prior_purchase', extra: { customerId } })
    ttl = PROMO_CHECK_ERROR_TTL_MS
  }
  priorPurchaseCache.set(customerId, { prior, until: now.getTime() + ttl })
  return prior
}

export type DiscountPurpose = 'referral_reward' | 'referral_welcome' | 'winback' | 'other'

export interface SubscriptionDiscountPart {
  couponId: string
  purpose: DiscountPurpose
  percentOff: number | null
  amountOffCents: number | null
  duration: 'repeating' | 'forever'
  /** When Stripe stops applying this part (repeating only); null otherwise. */
  endsAt: string | null
}

/**
 * The discounts running on a Stripe subscription (referral reward, referral
 * welcome, win-back), for the billing page: what the clinic pays now and until
 * when. The fields keep their single-discount meaning for the billing page.
 */
export interface SubscriptionDiscount {
  /** Per month with every active part applied, in Stripe's order, BRL cents. */
  discountedCents: number
  /** Per month without any, BRL cents (the Stripe price). */
  fullCents: number
  /** 'repeating' if any part repeats. */
  duration: 'repeating' | 'forever'
  /** Earliest end among the repeating parts; null otherwise. */
  endsAt: string | null
  /** Price once the earliest repeating part ends (the others still applied); null with no repeating part. */
  afterEndsCents: number | null
  parts: SubscriptionDiscountPart[]
  /** Percent of the referral_reward part, if any. */
  referralPercent: number | null
}

const subscriptionDiscountCache = new Map<string, { discount: SubscriptionDiscount | null; until: number }>()

/** Test hook. */
export function clearSubscriptionDiscountCache(): void {
  subscriptionDiscountCache.clear()
}

export function discountCouponOf(d: string | Stripe.Discount | Stripe.DeletedDiscount): Stripe.Coupon | null {
  if (typeof d === 'string') return null
  const coupon = 'source' in d ? d.source?.coupon : null
  return coupon && typeof coupon === 'object' ? coupon : null
}

/** Sequential: for each part, amount -= percent ? round(amount × p / 100) : amountOff; clamped at 0. */
export function combineDiscounts(
  fullCents: number,
  parts: Array<Pick<SubscriptionDiscountPart, 'percentOff' | 'amountOffCents'>>,
): number {
  let amount = fullCents
  for (const part of parts) {
    const off = part.percentOff ? Math.round((amount * part.percentOff) / 100) : (part.amountOffCents ?? 0)
    amount = Math.max(0, amount - off)
  }
  return amount
}

function discountPurpose(coupon: Stripe.Coupon): DiscountPurpose {
  const purpose = coupon.metadata?.purpose
  return purpose === 'referral_reward' || purpose === 'referral_welcome' ? purpose : 'other'
}

/**
 * The discounts on a subscription right now, read from Stripe (subscription
 * level, where Checkout puts a promotion code). One retrieve, cached per
 * server instance for 10 minutes and never past the earliest part's end.
 * Null when there is none or Stripe errors (the page then shows the plain
 * price, which is what it showed before).
 */
export async function getSubscriptionDiscount(
  subscriptionId: string,
  now: Date = new Date(),
  /** Our plan id: part of the cache key, so a plan switch reads Stripe again. */
  planKey: string = '',
): Promise<SubscriptionDiscount | null> {
  const cacheKey = `${subscriptionId}:${planKey}`
  const cached = subscriptionDiscountCache.get(cacheKey)
  if (cached && cached.until > now.getTime()) return cached.discount

  let discount: SubscriptionDiscount | null = null
  let until = now.getTime() + PROMO_CHECK_TTL_MS
  try {
    const sub = await getStripeClient().subscriptions.retrieve(subscriptionId, {
      // applies_to is only returned when expanded (4 levels, Stripe's limit).
      expand: ['discounts.source.coupon.applies_to'],
    })
    const item = sub.items?.data?.[0]
    const price = item?.price
    const fullCents =
      price && (price.currency ?? '').toLowerCase() === 'brl' && price.unit_amount != null
        ? price.unit_amount * (item.quantity ?? 1)
        : null
    const nowSec = Math.floor(now.getTime() / 1000)
    const productId = price ? (typeof price.product === 'string' ? price.product : price.product?.id) : null
    const parts: SubscriptionDiscountPart[] = []
    const ends: Array<number | null> = []
    for (const d of sub.discounts ?? []) {
      if (typeof d === 'string' || d.start > nowSec || (d.end != null && d.end <= nowSec)) continue
      const coupon = discountCouponOf(d)
      if (!coupon) continue
      // A coupon limited to other products stays on the subscription after a
      // plan switch but no longer discounts it.
      const applies = !coupon.applies_to || (!!productId && coupon.applies_to.products.includes(productId))
      // A `once` coupon is spent on the first invoice, which checkout already
      // paid, so there is nothing ahead to show.
      if (!applies || coupon.duration === 'once') continue
      const percentOff = coupon.percent_off || null
      const amountOffCents =
        !percentOff && coupon.amount_off != null && (coupon.currency ?? '').toLowerCase() === 'brl'
          ? coupon.amount_off
          : null
      if (!percentOff && !amountOffCents) continue
      parts.push({
        couponId: coupon.id,
        purpose: discountPurpose(coupon),
        percentOff,
        amountOffCents,
        duration: coupon.duration === 'forever' ? 'forever' : 'repeating',
        endsAt: d.end != null ? new Date(d.end * 1000).toISOString() : null,
      })
      ends.push(d.end ?? null)
    }
    if (fullCents != null && parts.length > 0) {
      const discountedCents = combineDiscounts(fullCents, parts)
      if (discountedCents < fullCents) {
        const endTimes = parts.flatMap((p) => (p.duration === 'repeating' && p.endsAt ? [p.endsAt] : []))
        const endsAt = endTimes.length > 0 ? endTimes.reduce((a, b) => (a <= b ? a : b)) : null
        const hasRepeating = parts.some((p) => p.duration === 'repeating')
        discount = {
          discountedCents,
          fullCents,
          duration: hasRepeating ? 'repeating' : 'forever',
          endsAt,
          afterEndsCents: hasRepeating
            ? combineDiscounts(
                fullCents,
                parts.filter((p) => !(p.duration === 'repeating' && p.endsAt === endsAt)),
              )
            : null,
          parts,
          referralPercent: parts.find((p) => p.purpose === 'referral_reward')?.percentOff ?? null,
        }
        for (const end of ends) if (end != null) until = Math.min(until, end * 1000)
      }
    }
  } catch (err) {
    reportSideEffectFailure(err, { area: 'billing', step: 'subscription_discount', extra: { subscriptionId } })
    until = now.getTime() + PROMO_CHECK_ERROR_TTL_MS
  }
  subscriptionDiscountCache.set(cacheKey, { discount, until })
  return discount
}

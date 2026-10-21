import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Switching plans used to double-bill.
 *
 * `createCheckoutSession` always opens a `mode: 'subscription'` checkout, and
 * the settings page offers "Assinar" on every paid plan that is not the
 * current one. A Starter customer who picked Pro got a SECOND Stripe
 * subscription on the same customer: both billed, and because a tenant holds
 * one subscription row, the Pro id overwrote the Starter one, so the Starter
 * subscription charged forever with nothing in the app able to cancel it.
 *
 * An existing subscription now moves onto the new price instead.
 */

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: vi.fn(),
  updateSubscriptionPrice: vi.fn(),
  // Stripe confirms the win-back code unless a test says otherwise.
  checkPromotionCode: vi.fn(async () => ({
    percentOff: 30,
    amountOffCents: null,
    duration: 'repeating',
    durationInMonths: 3,
    productIds: null,
    firstTimeTransaction: true,
    minimumAmountCents: null,
  })),
  getPriceInfo: vi.fn(async (priceId: string) => ({ productId: `prod_for_${priceId}`, unitAmountCents: 19900 })),
  customerHasPriorPurchase: vi.fn(async () => false),
}))
// Used the trial (a patient and an appointment) unless a test says otherwise.
vi.mock('@/db/queries/trial-recap', () => ({
  getTrialUsage: vi.fn(async () => ({ hasPatient: true, hasAppointment: true })),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: vi.fn(),
  getPlanBySlug: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getTrialUsage } from '@/db/queries/trial-recap'
import {
  checkPromotionCode,
  createCheckoutSession,
  customerHasPriorPurchase,
  updateSubscriptionPrice,
} from '@/lib/stripe'
import {
  getSubscription,
  getPlanBySlug,
  updateSubscriptionPlan,
  updateSubscriptionStatus,
} from '@/db/queries/subscriptions'
import { POST } from '../checkout/route'

const PRO_PLAN = {
  id: 'plan-pro',
  slug: 'pro',
  active: true,
  stripePriceId: 'price_pro',
}

function request(planSlug = 'pro') {
  return new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planSlug }),
  })
}

/** No Stripe subscription yet: the free/trial tenant. */
const NO_SUBSCRIPTION = {
  tenantId: 'tenant-1',
  planId: 'plan-free',
  status: 'trialing',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
}

/** Paying Starter. */
const STARTER_ACTIVE = {
  planId: 'plan-starter',
  status: 'active',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_starter',
  source: 'stripe',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getPlanBySlug).mockResolvedValue(PRO_PLAN as never)
  vi.mocked(getSubscription).mockResolvedValue(NO_SUBSCRIPTION as never)
  vi.mocked(createCheckoutSession).mockResolvedValue({
    sessionId: 'cs_1',
    url: 'https://checkout.stripe.com/cs_1',
  } as never)
  vi.mocked(updateSubscriptionPrice).mockResolvedValue({ id: 'sub_starter' } as never)
  vi.mocked(updateSubscriptionPlan).mockResolvedValue(undefined as never)
  vi.mocked(updateSubscriptionStatus).mockResolvedValue(undefined as never)
  vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'))
})

/** Cancelled, but the paid period has not closed yet. */
const CANCELED_OPEN = {
  planId: 'plan-starter',
  status: 'canceled',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_starter',
  source: 'stripe',
  currentPeriodEnd: new Date('2026-09-20T00:00:00.000Z'),
}

describe('POST /api/billing/checkout', () => {
  it('opens a checkout for a tenant with no paid subscription', async () => {
    const res = await POST(request())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ url: 'https://checkout.stripe.com/cs_1' })
    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: null })
    expect(updateSubscriptionPrice).not.toHaveBeenCalled()
  })

  it('moves an existing subscription onto the new price instead of opening a second one', async () => {
    vi.mocked(getSubscription).mockResolvedValue(STARTER_ACTIVE as never)

    const res = await POST(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.updated).toBe(true)
    expect(body.url).toBeNull()
    expect(updateSubscriptionPrice).toHaveBeenCalledWith('sub_starter', 'price_pro')
    // The whole point: no second subscription.
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('opens a fresh checkout for a gift row that still carries an old Stripe id', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ ...STARTER_ACTIVE, source: 'gift' } as never)

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(updateSubscriptionPrice).not.toHaveBeenCalled()
    expect(createCheckoutSession).toHaveBeenCalled()
  })

  it('records the new plan locally after the switch', async () => {
    vi.mocked(getSubscription).mockResolvedValue(STARTER_ACTIVE as never)

    await POST(request())

    expect(updateSubscriptionPlan).toHaveBeenCalledWith('tenant-1', 'plan-pro', 'stripe', {
      status: 'active',
      stripeSubscriptionId: 'sub_starter',
    })
  })

  it('refuses a switch to the plan the tenant is already on', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      ...STARTER_ACTIVE,
      planId: 'plan-pro',
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(400)
    expect(updateSubscriptionPrice).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('switches in place while a cancellation is still pending', async () => {
    // The subscription is live at Stripe until the period closes, so a
    // checkout here would run a second one alongside it and the customer
    // would pay twice for the overlap.
    vi.mocked(getSubscription).mockResolvedValue(CANCELED_OPEN as never)

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(updateSubscriptionPrice).toHaveBeenCalledWith('sub_starter', 'price_pro')
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('stops the row claiming it is cancelling after such a switch', async () => {
    // updateSubscriptionPrice clears cancel_at_period_end at Stripe, so the
    // local row would otherwise be the only thing still saying it ends.
    vi.mocked(getSubscription).mockResolvedValue(CANCELED_OPEN as never)

    await POST(request())

    expect(updateSubscriptionStatus).toHaveBeenCalledWith('tenant-1', 'active', {
      canceledAt: null,
    })
  })

  it('opens a checkout once the cancelled period has closed', async () => {
    // Stripe has ended it, so there is nothing to move onto a new price. The
    // customer id is reused so their details and invoices stay on one
    // customer.
    vi.mocked(getSubscription).mockResolvedValue({
      ...CANCELED_OPEN,
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', 'cus_1', { promotionCodeId: null })
    expect(updateSubscriptionPrice).not.toHaveBeenCalled()
  })

  it('switches in place for past_due instead of buying a second subscription', async () => {
    // The charge failed but the subscription is alive and Stripe is retrying
    // it. A checkout here means paying twice once the retry lands.
    vi.mocked(getSubscription).mockResolvedValue({
      ...STARTER_ACTIVE,
      status: 'past_due',
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(updateSubscriptionPrice).toHaveBeenCalledWith('sub_starter', 'price_pro')
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('does not call a past_due tenant active just because they switched', async () => {
    // Changing plan does not settle the unpaid invoice. Writing active would
    // unblock a tenant Stripe has not been paid by; the webhook says when.
    vi.mocked(getSubscription).mockResolvedValue({
      ...STARTER_ACTIVE,
      status: 'past_due',
    } as never)

    await POST(request())

    expect(updateSubscriptionPlan).toHaveBeenCalledWith('tenant-1', 'plan-pro', 'stripe', {
      status: 'past_due',
      stripeSubscriptionId: 'sub_starter',
    })
  })

  it('leaves the status alone on an ordinary switch', async () => {
    vi.mocked(getSubscription).mockResolvedValue(STARTER_ACTIVE as never)

    await POST(request())

    expect(updateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not the owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-2',
      role: 'receptionist',
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(createCheckoutSession).not.toHaveBeenCalled()
    expect(updateSubscriptionPrice).not.toHaveBeenCalled()
  })

  it('applies the win-back promotion code to an expired trial when one is configured', async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    const res = await POST(request('pro'))

    expect(res.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: 'promo_winback' })
  })

  it("charges full price when the clinic's Stripe customer has paid before (first-time-only code)", async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(customerHasPriorPurchase).mockResolvedValueOnce(true)
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeCustomerId: 'cus_old',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(customerHasPriorPurchase).toHaveBeenCalledWith('cus_old', expect.any(Date))
    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', 'cus_old', { promotionCodeId: null })
  })

  it('charges full price when the plan is under the code minimum amount', async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(checkPromotionCode).mockResolvedValueOnce({
      percentOff: 30,
      amountOffCents: null,
      duration: 'repeating',
      durationInMonths: 3,
      productIds: null,
      firstTimeTransaction: true,
      minimumAmountCents: 25000,
    })
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: null })
  })

  it.each([
    ['no patient', { hasPatient: false, hasAppointment: true }],
    ['no appointment', { hasPatient: true, hasAppointment: false }],
    ['neither', { hasPatient: false, hasAppointment: false }],
  ])('charges full price to a clinic that did not use the trial (%s)', async (_name, usage) => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(getTrialUsage).mockResolvedValueOnce(usage)
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(getTrialUsage).toHaveBeenCalledWith('tenant-1')
    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: null })
  })

  it('charges full price when Stripe says the win-back code is no longer usable', async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(checkPromotionCode).mockResolvedValueOnce(null)
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: null })
  })

  it('charges full price for a plan the win-back coupon does not cover', async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(checkPromotionCode).mockResolvedValueOnce({
      percentOff: 30,
      amountOffCents: null,
      duration: 'repeating',
      durationInMonths: 3,
      productIds: ['prod_for_price_starter'],
      firstTimeTransaction: true,
      minimumAmountCents: null,
    })
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: null })
  })

  it('still applies the code to a plan a restricted coupon covers', async () => {
    vi.stubEnv('STRIPE_WINBACK_PROMOTION_CODE_ID', 'promo_winback')
    vi.mocked(checkPromotionCode).mockResolvedValueOnce({
      percentOff: 30,
      amountOffCents: null,
      duration: 'repeating',
      durationInMonths: 3,
      productIds: ['prod_for_price_pro'],
      firstTimeTransaction: true,
      minimumAmountCents: null,
    })
    vi.mocked(getSubscription).mockResolvedValue({
      ...NO_SUBSCRIPTION,
      status: 'expired',
      source: 'trial',
      stripeSubscriptionId: null,
      firstPaidAt: null,
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    } as never)

    await POST(request('pro'))

    expect(createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'pro', null, { promotionCodeId: 'promo_winback' })
  })
})

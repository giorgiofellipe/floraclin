import { beforeEach, describe, expect, it, vi } from 'vitest'

// The win-back discount must never stop a clinic from paying: a bad or
// expired promotion code falls back to full price, and only that kind of
// error does.
const { create, report, retrievePromo, retrievePrice, listSubs, listCharges, listInvoices, retrieveSub, updateSub } = vi.hoisted(() => ({
  updateSub: vi.fn(),
  retrieveSub: vi.fn(),
  create: vi.fn(),
  report: vi.fn(),
  retrievePromo: vi.fn(),
  retrievePrice: vi.fn(),
  listSubs: vi.fn(),
  listCharges: vi.fn(),
  listInvoices: vi.fn(),
}))

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  class FakeStripe {
    static errors = actual.default.errors
    customers = { create: vi.fn() }
    checkout = { sessions: { create } }
    promotionCodes = { retrieve: retrievePromo }
    prices = { retrieve: retrievePrice }
    subscriptions = { list: listSubs, retrieve: retrieveSub, update: updateSub }
    charges = { list: listCharges }
    invoices = { list: listInvoices }
  }
  return { default: FakeStripe }
})
vi.mock('@/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ slug: 'pro', stripePriceId: 'price_pro' }] }) }) }),
  },
}))
vi.mock('@/db/schema', () => ({ plans: { slug: 'slug' } }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: report }))

import Stripe from 'stripe'
import {
  updateSubscriptionDiscounts,
  checkPromotionCode,
  clearPromotionCodeCache,
  createCheckoutSession,
  customerHasPriorPurchase,
  getPriceInfo,
  getSubscriptionDiscount,
  getStripeSubscriptionState,
  clearSubscriptionDiscountCache,
} from '@/lib/stripe'

function invalidRequest(param: string, message: string) {
  return new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', param, message })
}

beforeEach(() => {
  create.mockReset()
  report.mockReset()
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
})

describe('createCheckoutSession', () => {
  it('attaches the promotion code as a discount', async () => {
    create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' })

    await createCheckoutSession('t1', 'pro', 'cus_1', { promotionCodeId: 'promo_1' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ discounts: [{ promotion_code: 'promo_1' }], metadata: expect.objectContaining({ winback: 'true' }) }),
    )
  })

  it('falls back to full price when Stripe rejects the promotion code, and reports it', async () => {
    create
      .mockRejectedValueOnce(invalidRequest('discounts[0][promotion_code]', 'This promotion code has expired.'))
      .mockResolvedValueOnce({ id: 'cs_2', url: 'https://checkout/cs_2' })

    const result = await createCheckoutSession('t1', 'pro', 'cus_1', { promotionCodeId: 'promo_1' })

    expect(result.url).toBe('https://checkout/cs_2')
    expect(create).toHaveBeenLastCalledWith(expect.not.objectContaining({ discounts: expect.anything() }))
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'winback_discount' }))
  })

  it('does not swallow an unrelated invalid request', async () => {
    create.mockRejectedValue(invalidRequest('customer', 'No such customer: cus_1'))

    await expect(createCheckoutSession('t1', 'pro', 'cus_1', { promotionCodeId: 'promo_1' })).rejects.toThrow('No such customer')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('sends no discount without a promotion code', async () => {
    create.mockResolvedValue({ id: 'cs_3', url: 'https://checkout/cs_3' })

    await createCheckoutSession('t1', 'pro', 'cus_1')

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ discounts: expect.anything() }))
  })

  // Regression: the webhook's Subscribe event had no IP or user agent, which Meta requires on website events.
  it('keeps the buyer browser signals on the session for the Subscribe event', async () => {
    create.mockResolvedValue({ id: 'cs_4', url: 'https://checkout/cs_4' })

    await createCheckoutSession('t1', 'pro', 'cus_1', {
      browser: { clientIp: '203.0.113.7', userAgent: 'x'.repeat(600), fbp: 'fb.1.1.browser' },
    })

    const { metadata } = create.mock.calls[0][0]
    expect(metadata).toMatchObject({ tenantId: 't1', planSlug: 'pro', meta_ip: '203.0.113.7', meta_fbp: 'fb.1.1.browser' })
    expect(metadata.meta_ua).toHaveLength(500)
    expect(metadata).not.toHaveProperty('meta_fbc')
  })
})

describe('checkPromotionCode', () => {
  const TERMS = {
    percentOff: 30,
    amountOffCents: null,
    duration: 'repeating',
    durationInMonths: 3,
    productIds: null,
    firstTimeTransaction: true,
    minimumAmountCents: null,
  }
  const NOW = new Date('2026-10-21T13:00:00.000Z')
  const nowSec = Math.floor(NOW.getTime() / 1000)
  const promo = (over: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) => ({
    active: true,
    expires_at: null,
    max_redemptions: 100,
    times_redeemed: 3,
    restrictions: { first_time_transaction: true, minimum_amount: null, minimum_amount_currency: null },
    promotion: {
      type: 'coupon',
      coupon: { valid: true, percent_off: 30, duration: 'repeating', duration_in_months: 3, ...coupon },
    },
    ...over,
  })

  beforeEach(() => {
    retrievePromo.mockReset()
    clearPromotionCodeCache()
  })

  it('returns the coupon terms for a usable code', async () => {
    retrievePromo.mockResolvedValue(promo())
    expect(await checkPromotionCode('promo_1', NOW)).toEqual(TERMS)
    expect(retrievePromo).toHaveBeenCalledWith('promo_1', { expand: ['promotion.coupon', 'promotion.coupon.applies_to'] })
  })

  it.each([
    ['inactive', promo({ active: false })],
    ['past expires_at', promo({ expires_at: nowSec - 1 })],
    ['out of redemptions', promo({ times_redeemed: 100 })],
    ['with an invalid coupon', promo({}, { valid: false })],
    ['with an amount off in another currency', promo({}, { percent_off: null, amount_off: 1000, currency: 'usd' })],
    [
      'with a minimum amount only in another currency',
      promo({ restrictions: { first_time_transaction: false, minimum_amount: 5000, minimum_amount_currency: 'usd' } }),
    ],
  ])('treats a code %s as unusable', async (_name, value) => {
    retrievePromo.mockResolvedValue(value)
    expect(await checkPromotionCode('promo_1', NOW)).toBeNull()
  })

  it('carries the products the coupon is restricted to', async () => {
    retrievePromo.mockResolvedValue(promo({}, { applies_to: { products: ['prod_pro'] } }))
    expect(await checkPromotionCode('promo_1', NOW)).toEqual({ ...TERMS, productIds: ['prod_pro'] })
  })

  it('reads a BRL amount-off coupon and its duration', async () => {
    retrievePromo.mockResolvedValue(promo({}, { percent_off: null, amount_off: 5000, currency: 'brl', duration: 'once' }))
    expect(await checkPromotionCode('promo_1', NOW)).toEqual({
      percentOff: null,
      amountOffCents: 5000,
      duration: 'once',
      durationInMonths: null,
      productIds: null,
      firstTimeTransaction: true,
      minimumAmountCents: null,
    })
  })

  it('reads the first-time and BRL minimum-amount restrictions', async () => {
    retrievePromo.mockResolvedValue(
      promo({ restrictions: { first_time_transaction: false, minimum_amount: 15000, minimum_amount_currency: 'brl' } }),
    )
    expect(await checkPromotionCode('promo_1', NOW)).toEqual({ ...TERMS, firstTimeTransaction: false, minimumAmountCents: 15000 })
  })

  it('prefers a BRL currency option for the minimum amount', async () => {
    retrievePromo.mockResolvedValue(
      promo({
        restrictions: {
          first_time_transaction: true,
          minimum_amount: 3000,
          minimum_amount_currency: 'usd',
          currency_options: { brl: { minimum_amount: 15000 } },
        },
      }),
    )
    expect(await checkPromotionCode('promo_1', NOW)).toEqual({ ...TERMS, minimumAmountCents: 15000 })
  })

  it('caches the answer, so the layout does not call Stripe on every render', async () => {
    retrievePromo.mockResolvedValue(promo())
    await checkPromotionCode('promo_1', NOW)
    await checkPromotionCode('promo_1', new Date(NOW.getTime() + 5 * 60 * 1000))
    expect(retrievePromo).toHaveBeenCalledTimes(1)
    await checkPromotionCode('promo_1', new Date(NOW.getTime() + 11 * 60 * 1000))
    expect(retrievePromo).toHaveBeenCalledTimes(2)
  })

  it('hides the offer on a Stripe error and retries after a minute', async () => {
    retrievePromo.mockRejectedValueOnce(new Error('stripe down')).mockResolvedValue(promo())
    expect(await checkPromotionCode('promo_1', NOW)).toBeNull()
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'winback_promo_check' }))
    expect(await checkPromotionCode('promo_1', new Date(NOW.getTime() + 61 * 1000))).toEqual(TERMS)
  })
})

describe('getPriceInfo', () => {
  const NOW = new Date('2026-10-21T13:00:00.000Z')

  beforeEach(() => {
    retrievePrice.mockReset()
    clearPromotionCodeCache()
  })

  it('reads the product id, string or expanded, and the BRL amount, cached for 10 minutes', async () => {
    retrievePrice
      .mockResolvedValueOnce({ product: 'prod_pro', currency: 'brl', unit_amount: 19900 })
      .mockResolvedValueOnce({ product: { id: 'prod_pro2' }, currency: 'usd', unit_amount: 4000 })
    expect(await getPriceInfo('price_pro', NOW)).toEqual({ productId: 'prod_pro', unitAmountCents: 19900 })
    expect(await getPriceInfo('price_pro', new Date(NOW.getTime() + 9 * 60 * 1000))).toEqual({
      productId: 'prod_pro',
      unitAmountCents: 19900,
    })
    expect(retrievePrice).toHaveBeenCalledTimes(1)
    expect(await getPriceInfo('price_pro', new Date(NOW.getTime() + 11 * 60 * 1000))).toEqual({
      productId: 'prod_pro2',
      unitAmountCents: null,
    })
  })

  it('returns null on a Stripe error (plan not covered) and retries after a minute', async () => {
    retrievePrice.mockRejectedValueOnce(new Error('stripe down')).mockResolvedValue({ product: 'prod_pro', currency: 'brl', unit_amount: 19900 })
    expect(await getPriceInfo('price_pro', NOW)).toBeNull()
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'winback_price_product' }))
    expect(await getPriceInfo('price_pro', new Date(NOW.getTime() + 30 * 1000))).toBeNull()
    expect((await getPriceInfo('price_pro', new Date(NOW.getTime() + 61 * 1000)))?.productId).toBe('prod_pro')
  })
})

describe('customerHasPriorPurchase', () => {
  const NOW = new Date('2026-10-21T13:00:00.000Z')
  const page = (data: unknown[]) => ({ data })

  beforeEach(() => {
    listSubs.mockReset().mockResolvedValue(page([]))
    listCharges.mockReset().mockResolvedValue(page([]))
    listInvoices.mockReset().mockResolvedValue(page([]))
    clearPromotionCodeCache()
  })

  it('is false for a customer that only abandoned checkout', async () => {
    listSubs.mockResolvedValue(page([{ status: 'incomplete_expired' }]))
    listCharges.mockResolvedValue(page([{ status: 'failed' }]))
    expect(await customerHasPriorPurchase('cus_1', NOW)).toBe(false)
    expect(listSubs).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 100 })
    expect(listInvoices).toHaveBeenCalledWith({ customer: 'cus_1', status: 'paid', limit: 1 })
  })

  it.each([
    ['a subscription that started', () => listSubs.mockResolvedValue(page([{ status: 'canceled' }]))],
    ['a successful charge', () => listCharges.mockResolvedValue(page([{ status: 'succeeded' }]))],
    ['a paid invoice', () => listInvoices.mockResolvedValue(page([{ id: 'in_1' }]))],
  ])('is true with %s', async (_name, arrange) => {
    arrange()
    expect(await customerHasPriorPurchase('cus_1', NOW)).toBe(true)
  })

  it('caches for 10 minutes', async () => {
    await customerHasPriorPurchase('cus_1', NOW)
    await customerHasPriorPurchase('cus_1', new Date(NOW.getTime() + 9 * 60 * 1000))
    expect(listSubs).toHaveBeenCalledTimes(1)
    await customerHasPriorPurchase('cus_1', new Date(NOW.getTime() + 11 * 60 * 1000))
    expect(listSubs).toHaveBeenCalledTimes(2)
  })

  it('counts a Stripe error as a prior purchase (no offer), reports it and retries after a minute', async () => {
    listSubs.mockRejectedValueOnce(new Error('stripe down'))
    expect(await customerHasPriorPurchase('cus_1', NOW)).toBe(true)
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'promo_prior_purchase' }))
    expect(await customerHasPriorPurchase('cus_1', new Date(NOW.getTime() + 61 * 1000))).toBe(false)
  })
})

describe('getSubscriptionDiscount', () => {
  const NOW = new Date('2026-10-21T13:00:00.000Z')
  const nowSec = Math.floor(NOW.getTime() / 1000)
  const END = nowSec + 90 * 86_400
  const sub = (discounts: unknown[], price: Record<string, unknown> = { currency: 'brl', unit_amount: 9900 }) => ({
    items: { data: [{ quantity: 1, price: { product: 'prod_starter', ...price } }] },
    discounts,
  })
  const discount = (coupon: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    start: nowSec - 60,
    end: END,
    source: { type: 'coupon', coupon: { duration: 'repeating', ...coupon } },
    ...over,
  })

  beforeEach(() => {
    retrieveSub.mockReset()
    clearSubscriptionDiscountCache()
  })

  it('reads Stripe again right after the referral sync changes the discounts, not the cached price', async () => {
    retrieveSub.mockResolvedValueOnce(sub([])).mockResolvedValueOnce(sub([discount({ percent_off: 20 }, { end: null })]))
    expect(await getSubscriptionDiscount('sub_1', NOW, 'plan-1')).toBeNull()
    updateSub.mockResolvedValue({})
    await updateSubscriptionDiscounts('sub_1', [{ coupon: 'c20' }])
    expect((await getSubscriptionDiscount('sub_1', NOW, 'plan-1'))?.discountedCents).toBe(7920)
  })

  it('reads the discounted price and when it ends from the subscription discount', async () => {
    retrieveSub.mockResolvedValue(sub([discount({ percent_off: 30 })]))
    expect(await getSubscriptionDiscount('sub_1', NOW)).toEqual({
      discountedCents: 6930,
      fullCents: 9900,
      duration: 'repeating',
      endsAt: new Date(END * 1000).toISOString(),
      afterEndsCents: 9900,
      parts: [
        {
          couponId: undefined,
          purpose: 'other',
          percentOff: 30,
          amountOffCents: null,
          duration: 'repeating',
          endsAt: new Date(END * 1000).toISOString(),
        },
      ],
      referralPercent: null,
    })
    expect(retrieveSub).toHaveBeenCalledWith('sub_1', { expand: ['discounts.source.coupon.applies_to'] })
  })

  it('ignores a coupon limited to another product (kept after a plan switch)', async () => {
    retrieveSub.mockResolvedValue(sub([discount({ percent_off: 30, applies_to: { products: ['prod_pro'] } })]))
    expect(await getSubscriptionDiscount('sub_1', NOW)).toBeNull()
    retrieveSub.mockResolvedValue(sub([discount({ percent_off: 30, applies_to: { products: ['prod_starter'] } })]))
    expect((await getSubscriptionDiscount('sub_1', NOW, 'plan-other'))?.discountedCents).toBe(6930)
  })

  it('reads Stripe again after a plan switch (plan in the cache key)', async () => {
    retrieveSub.mockResolvedValue(sub([discount({ percent_off: 30 })]))
    await getSubscriptionDiscount('sub_1', NOW, 'plan-starter')
    await getSubscriptionDiscount('sub_1', NOW, 'plan-starter')
    await getSubscriptionDiscount('sub_1', NOW, 'plan-pro')
    expect(retrieveSub).toHaveBeenCalledTimes(2)
  })

  it('reads a forever BRL amount off', async () => {
    retrieveSub.mockResolvedValue(sub([discount({ amount_off: 2000, currency: 'brl', duration: 'forever' }, { end: null })]))
    expect(await getSubscriptionDiscount('sub_1', NOW)).toMatchObject({ discountedCents: 7900, endsAt: null, duration: 'forever' })
  })

  it.each([
    ['no discount', sub([])],
    ['a discount that already ended', sub([discount({ percent_off: 30 }, { end: nowSec - 1 })])],
    ['a once coupon (spent on the first invoice)', sub([discount({ percent_off: 30, duration: 'once' }, { end: null })])],
    ['a non-BRL price', sub([discount({ percent_off: 30 })], { currency: 'usd', unit_amount: 2000 })],
  ])('is null with %s', async (_name, value) => {
    retrieveSub.mockResolvedValue(value)
    expect(await getSubscriptionDiscount('sub_1', NOW)).toBeNull()
  })

  it('caches it, never past the discount end, and is null on a Stripe error', async () => {
    retrieveSub.mockResolvedValue(sub([discount({ percent_off: 30 }, { end: nowSec + 120 })]))
    await getSubscriptionDiscount('sub_1', NOW)
    await getSubscriptionDiscount('sub_1', new Date(NOW.getTime() + 60_000))
    expect(retrieveSub).toHaveBeenCalledTimes(1)
    retrieveSub.mockRejectedValue(new Error('stripe down'))
    expect(await getSubscriptionDiscount('sub_1', new Date(NOW.getTime() + 121_000))).toBeNull()
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'subscription_discount' }))
  })
})

describe('getStripeSubscriptionState', () => {
  beforeEach(() => retrieveSub.mockReset())

  it.each([
    [{ status: 'active', cancel_at_period_end: true }, 'pending_cancel'],
    [{ status: 'active', cancel_at_period_end: false }, 'live'],
    [{ status: 'canceled', cancel_at_period_end: false }, 'ended'],
    [{ status: 'incomplete_expired', cancel_at_period_end: false }, 'ended'],
  ])('maps %o to %s', async (sub, state) => {
    retrieveSub.mockResolvedValue(sub)
    expect(await getStripeSubscriptionState('sub_1')).toBe(state)
  })

  it('treats a subscription Stripe no longer has as ended, and rethrows anything else', async () => {
    const missing = new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription' })
    retrieveSub.mockRejectedValueOnce(missing)
    expect(await getStripeSubscriptionState('sub_gone')).toBe('ended')
    retrieveSub.mockRejectedValueOnce(new Error('network'))
    await expect(getStripeSubscriptionState('sub_1')).rejects.toThrow('network')
  })
})

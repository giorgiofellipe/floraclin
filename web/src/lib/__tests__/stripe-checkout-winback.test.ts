import { beforeEach, describe, expect, it, vi } from 'vitest'

// The win-back discount must never stop a clinic from paying: a bad or
// expired promotion code falls back to full price, and only that kind of
// error does.
const { create, report, retrievePromo } = vi.hoisted(() => ({ create: vi.fn(), report: vi.fn(), retrievePromo: vi.fn() }))

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  class FakeStripe {
    static errors = actual.default.errors
    customers = { create: vi.fn() }
    checkout = { sessions: { create } }
    promotionCodes = { retrieve: retrievePromo }
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
import { checkPromotionCode, clearPromotionCodeCache, createCheckoutSession } from '@/lib/stripe'

function invalidRequest(param: string, message: string) {
  return new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', param, message })
}

beforeEach(() => {
  create.mockReset()
  report.mockReset()
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
})

describe('createCheckoutSession with a win-back promotion code', () => {
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
})

describe('checkPromotionCode', () => {
  const NOW = new Date('2026-10-21T13:00:00.000Z')
  const nowSec = Math.floor(NOW.getTime() / 1000)
  const promo = (over: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) => ({
    active: true,
    expires_at: null,
    max_redemptions: 100,
    times_redeemed: 3,
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
    expect(await checkPromotionCode('promo_1', NOW)).toEqual({ percentOff: 30, durationInMonths: 3 })
    expect(retrievePromo).toHaveBeenCalledWith('promo_1', { expand: ['promotion.coupon'] })
  })

  it.each([
    ['inactive', promo({ active: false })],
    ['past expires_at', promo({ expires_at: nowSec - 1 })],
    ['out of redemptions', promo({ times_redeemed: 100 })],
    ['with an invalid coupon', promo({}, { valid: false })],
  ])('treats a code %s as unusable', async (_name, value) => {
    retrievePromo.mockResolvedValue(value)
    expect(await checkPromotionCode('promo_1', NOW)).toBeNull()
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
    expect(await checkPromotionCode('promo_1', new Date(NOW.getTime() + 61 * 1000))).toEqual({ percentOff: 30, durationInMonths: 3 })
  })
})

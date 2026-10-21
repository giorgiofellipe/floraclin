import { beforeEach, describe, expect, it, vi } from 'vitest'

// The win-back discount must never stop a clinic from paying: a bad or
// expired promotion code falls back to full price, and only that kind of
// error does.
const { create, report } = vi.hoisted(() => ({ create: vi.fn(), report: vi.fn() }))

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  class FakeStripe {
    static errors = actual.default.errors
    customers = { create: vi.fn() }
    checkout = { sessions: { create } }
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
import { createCheckoutSession } from '@/lib/stripe'

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

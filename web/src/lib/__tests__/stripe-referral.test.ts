import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  create: vi.fn(),
  report: vi.fn(),
  subsRetrieve: vi.fn(),
  subsUpdate: vi.fn(),
  subsList: vi.fn(),
  invList: vi.fn(),
  invUpdate: vi.fn(),
  chargesList: vi.fn(),
  chargesRetrieve: vi.fn(),
  invRetrieve: vi.fn(),
  invoicePaymentsList: vi.fn(),
  customersSearch: vi.fn(),
  sessionsList: vi.fn(),
  sessionsExpire: vi.fn(),
  couponsRetrieve: vi.fn(),
}))

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  class FakeStripe {
    static errors = actual.default.errors
    customers = { create: vi.fn(), search: m.customersSearch }
    coupons = { retrieve: m.couponsRetrieve }
    checkout = { sessions: { create: m.create, list: m.sessionsList, expire: m.sessionsExpire } }
    subscriptions = { retrieve: m.subsRetrieve, update: m.subsUpdate, list: m.subsList }
    invoices = { list: m.invList, update: m.invUpdate, retrieve: m.invRetrieve }
    invoicePayments = { list: m.invoicePaymentsList }
    charges = { list: m.chargesList, retrieve: m.chargesRetrieve }
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
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: m.report }))

import Stripe from 'stripe'
import {
  STRIPE_LIST_CAP,
  clearSubscriptionDiscountCache,
  combineDiscounts,
  createCheckoutSession,
  findEarliestSubscriptionId,
  prepareReferralAttach,
  referrerCouponsMatchTerms,
  getSubscriptionDiscount,
  listCustomerCardSightings,
  listOpenCycleDrafts,
  listPaidSubscriptionInvoices,
  retrieveDisputeTarget,
  retrieveSubscriptionOrMissing,
  updateInvoiceDiscounts,
  updateSubscriptionDiscounts,
} from '@/lib/stripe'

/** Mimics a Stripe list: autoPagingToArray walks the pages and honours `limit`. */
function paged<T>(pages: T[][]) {
  return {
    data: pages[0] ?? [],
    autoPagingToArray: async ({ limit }: { limit: number }) => pages.flat().slice(0, limit),
  }
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  clearSubscriptionDiscountCache()
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
})

describe('combineDiscounts', () => {
  it('applies percentages sequentially', () => {
    expect(combineDiscounts(9900, [{ percentOff: 20, amountOffCents: null }, { percentOff: 30, amountOffCents: null }])).toBe(5544)
  })
  it('100% gives 0', () => {
    expect(combineDiscounts(9900, [{ percentOff: 100, amountOffCents: null }])).toBe(0)
  })
  it('applies an amount off before a percent', () => {
    expect(combineDiscounts(9900, [{ percentOff: null, amountOffCents: 1900 }, { percentOff: 50, amountOffCents: null }])).toBe(4000)
  })
  it('never goes below zero', () => {
    expect(combineDiscounts(1000, [{ percentOff: null, amountOffCents: 5000 }, { percentOff: 20, amountOffCents: null }])).toBe(0)
  })
})

describe('getSubscriptionDiscount with several parts', () => {
  const NOW = new Date('2026-10-21T13:00:00.000Z')
  const nowSec = Math.floor(NOW.getTime() / 1000)
  const END = Math.floor(new Date('2026-12-21T12:00:00.000Z').getTime() / 1000)
  const sub = (discounts: unknown[]) => ({
    items: { data: [{ quantity: 1, price: { product: 'prod_a', currency: 'brl', unit_amount: 9900 } }] },
    discounts,
  })
  const discount = (id: string, coupon: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    start: nowSec - 60,
    end: null,
    source: { type: 'coupon', coupon: { id, duration: 'forever', ...coupon } },
    ...over,
  })
  const reward40 = discount('c40', { percent_off: 40, metadata: { purpose: 'referral_reward' } })
  const welcome20 = discount(
    'cw20',
    { percent_off: 20, duration: 'repeating', metadata: { purpose: 'referral_welcome' } },
    { end: END },
  )

  it('combines a forever reward and a repeating welcome', async () => {
    m.subsRetrieve.mockResolvedValue(sub([reward40, welcome20]))
    const result = await getSubscriptionDiscount('sub_1', NOW)
    expect(result).toMatchObject({
      discountedCents: 4752,
      fullCents: 9900,
      afterEndsCents: 5940,
      referralPercent: 40,
      duration: 'repeating',
      endsAt: new Date(END * 1000).toISOString(),
    })
    expect(result?.parts.map((p) => [p.couponId, p.purpose])).toEqual([
      ['c40', 'referral_reward'],
      ['cw20', 'referral_welcome'],
    ])
  })

  it('ignores a once part', async () => {
    m.subsRetrieve.mockResolvedValue(sub([reward40, discount('o', { percent_off: 50, duration: 'once' })]))
    const result = await getSubscriptionDiscount('sub_1', NOW)
    expect(result?.parts).toHaveLength(1)
    expect(result).toMatchObject({ discountedCents: 5940, afterEndsCents: null, endsAt: null, duration: 'forever' })
  })

  it('ignores a part restricted to other products', async () => {
    m.subsRetrieve.mockResolvedValue(sub([reward40, discount('x', { percent_off: 50, applies_to: { products: ['prod_b'] } })]))
    expect((await getSubscriptionDiscount('sub_1', NOW))?.parts).toHaveLength(1)
  })

  it('ignores an expired part', async () => {
    m.subsRetrieve.mockResolvedValue(sub([reward40, discount('e', { percent_off: 50, duration: 'repeating' }, { end: nowSec - 1 })]))
    expect((await getSubscriptionDiscount('sub_1', NOW))?.parts).toHaveLength(1)
  })
})

describe('createCheckoutSession with a referral discount', () => {
  const invalid = () =>
    new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', param: 'discounts[0][promotion_code]', message: 'expired' })

  it('flags the session as referral and carries the referral id', async () => {
    m.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' })
    await createCheckoutSession('t1', 'pro', 'cus_1', { promotionCodeId: 'promo_1', discountKind: 'referral', referralId: 'ref_1' })
    const arg = m.create.mock.calls[0][0]
    expect(arg.discounts).toEqual([{ promotion_code: 'promo_1' }])
    expect(arg.metadata).toMatchObject({ referral: 'true', referralId: 'ref_1' })
    expect(arg.metadata).not.toHaveProperty('winback')
  })

  it('falls back to full price keeping the referral id, reporting a referral_discount step', async () => {
    m.create.mockRejectedValueOnce(invalid()).mockResolvedValueOnce({ id: 'cs_2', url: 'https://checkout/cs_2' })
    await createCheckoutSession('t1', 'pro', 'cus_1', { promotionCodeId: 'promo_1', discountKind: 'referral', referralId: 'ref_1' })
    const fallback = m.create.mock.calls[1][0]
    expect(fallback).not.toHaveProperty('discounts')
    expect(fallback.metadata).toMatchObject({ referralId: 'ref_1' })
    expect(fallback.metadata).not.toHaveProperty('referral')
    expect(m.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'referral_discount' }))
  })

  it('carries the referral id even without a discount', async () => {
    m.create.mockResolvedValue({ id: 'cs_3', url: 'https://checkout/cs_3' })
    await createCheckoutSession('t1', 'pro', 'cus_1', { referralId: 'ref_1' })
    expect(m.create.mock.calls[0][0].metadata).toMatchObject({ referralId: 'ref_1' })
    expect(m.create.mock.calls[0][0]).not.toHaveProperty('discounts')
  })
})

describe('listPaidSubscriptionInvoices', () => {
  const inv = (id: string, paid: number | null) => ({
    id,
    billing_reason: 'subscription_cycle',
    amount_paid: 9900,
    status_transitions: { paid_at: paid },
  })

  it('reads every page and returns the oldest first', async () => {
    m.invList.mockReturnValue(paged([[inv('in_new', 2000)], [inv('in_old', 1000)]]))
    const result = await listPaidSubscriptionInvoices('sub_1')
    expect(m.invList).toHaveBeenCalledWith({ subscription: 'sub_1', status: 'paid', limit: 100 })
    expect(result.map((i) => i.id)).toEqual(['in_old', 'in_new'])
    expect(result[0]).toEqual({ id: 'in_old', billingReason: 'subscription_cycle', amountPaid: 9900, paidAt: new Date(1_000_000) })
    expect(m.report).not.toHaveBeenCalled()
  })

  it('reports when the cap is hit and returns what it has', async () => {
    const many = Array.from({ length: STRIPE_LIST_CAP + 5 }, (_, i) => inv(`in_${i}`, i))
    m.invList.mockReturnValue(paged([many]))
    const result = await listPaidSubscriptionInvoices('sub_1')
    expect(result).toHaveLength(STRIPE_LIST_CAP)
    expect(m.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'stripe_list_cap' }))
  })
})

describe('listCustomerCardSightings', () => {
  const charge = (fp: string | null, created: number, status = 'succeeded') => ({
    status,
    created,
    payment_method_details: { card: fp ? { fingerprint: fp } : {} },
  })

  it('dedups per fingerprint across pages, skips failed charges, keeps min/max created', async () => {
    m.chargesList.mockReturnValue(
      paged([
        [charge('fp_a', 3000), charge('fp_b', 500, 'failed')],
        [charge('fp_a', 1000), charge('fp_c', 2000), charge(null, 10)],
      ]),
    )
    const result = await listCustomerCardSightings('cus_1')
    expect(m.chargesList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 100 })
    expect(result).toEqual([
      { fingerprint: 'fp_a', firstSeenAt: new Date(1_000_000), lastSeenAt: new Date(3_000_000) },
      { fingerprint: 'fp_c', firstSeenAt: new Date(2_000_000), lastSeenAt: new Date(2_000_000) },
    ])
  })
})

describe('findEarliestSubscriptionId', () => {
  it('picks the minimum created across pages with status all', async () => {
    m.subsList.mockReturnValue(paged([[{ id: 'sub_b', created: 200 }], [{ id: 'sub_a', created: 100 }]]))
    expect(await findEarliestSubscriptionId('cus_1')).toBe('sub_a')
    expect(m.subsList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 100 })
  })
  it('is null with no subscription', async () => {
    m.subsList.mockReturnValue(paged([[]]))
    expect(await findEarliestSubscriptionId('cus_1')).toBeNull()
  })
})

describe('listOpenCycleDrafts', () => {
  it('keeps only subscription_cycle drafts', async () => {
    m.invList.mockResolvedValue({
      data: [
        { id: 'in_1', billing_reason: 'subscription_cycle' },
        { id: 'in_2', billing_reason: 'subscription_update' },
      ],
    })
    expect((await listOpenCycleDrafts('sub_1')).map((i) => i.id)).toEqual(['in_1'])
    expect(m.invList).toHaveBeenCalledWith(expect.objectContaining({ subscription: 'sub_1', status: 'draft' }))
  })
})

describe('discount updates', () => {
  it('send no idempotency key', async () => {
    m.subsUpdate.mockResolvedValue({})
    m.invUpdate.mockResolvedValue({})
    await updateSubscriptionDiscounts('sub_1', [{ coupon: 'c20' }])
    await updateInvoiceDiscounts('in_1', [{ coupon: 'c20' }])
    expect(m.subsUpdate).toHaveBeenCalledWith('sub_1', { discounts: [{ coupon: 'c20' }], proration_behavior: 'none' })
    expect(m.subsUpdate.mock.calls[0]).toHaveLength(2)
    expect(m.invUpdate).toHaveBeenCalledWith('in_1', { discounts: [{ coupon: 'c20' }] })
    expect(m.invUpdate.mock.calls[0]).toHaveLength(2)
  })

  // Seen in Stripe test mode: discounts: [] is dropped from the request and the coupon stays.
  it("removes the last discount with '' rather than an empty array", async () => {
    m.subsUpdate.mockResolvedValue({})
    m.invUpdate.mockResolvedValue({})
    await updateSubscriptionDiscounts('sub_1', [])
    await updateInvoiceDiscounts('in_1', [])
    expect(m.subsUpdate).toHaveBeenCalledWith('sub_1', { discounts: '', proration_behavior: 'none' })
    expect(m.invUpdate).toHaveBeenCalledWith('in_1', { discounts: '' })
  })
})

describe('retrieveSubscriptionOrMissing', () => {
  it("maps resource_missing to 'missing' and rethrows anything else", async () => {
    m.subsRetrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'resource_missing', message: 'gone' }),
    )
    expect(await retrieveSubscriptionOrMissing('sub_x')).toBe('missing')
    m.subsRetrieve.mockRejectedValueOnce(new Error('network'))
    await expect(retrieveSubscriptionOrMissing('sub_x')).rejects.toThrow('network')
  })
})

describe('retrieveDisputeTarget', () => {
  const dispute = (charge: unknown) => ({ charge }) as unknown as Stripe.Dispute
  const subInvoice = (sub: string) => ({ id: 'in_1', parent: { subscription_details: { subscription: sub } } })

  it('resolves charge → invoice payment → invoice → subscription', async () => {
    m.chargesRetrieve.mockResolvedValue({ customer: 'cus_1', payment_intent: 'pi_1' })
    m.invoicePaymentsList.mockResolvedValue({ data: [{ invoice: 'in_1' }] })
    m.invRetrieve.mockResolvedValue(subInvoice('sub_1'))
    expect(await retrieveDisputeTarget(dispute('ch_1'))).toEqual({ customerId: 'cus_1', subscriptionId: 'sub_1' })
    expect(m.chargesRetrieve).toHaveBeenCalledWith('ch_1')
    expect(m.invoicePaymentsList).toHaveBeenCalledWith({
      payment: { type: 'payment_intent', payment_intent: 'pi_1' },
      limit: 1,
    })
    expect(m.invRetrieve).toHaveBeenCalledWith('in_1')
  })
  it('uses an expanded invoice without another retrieve', async () => {
    m.invoicePaymentsList.mockResolvedValue({ data: [{ invoice: subInvoice('sub_2') }] })
    const res = await retrieveDisputeTarget(dispute({ customer: { id: 'cus_2' }, payment_intent: { id: 'pi_2' } }))
    expect(res).toEqual({ customerId: 'cus_2', subscriptionId: 'sub_2' })
    expect(m.invRetrieve).not.toHaveBeenCalled()
  })
  it('has no subscription for a charge without a payment intent or invoice', async () => {
    expect(await retrieveDisputeTarget(dispute({ customer: 'cus_1', payment_intent: null }))).toEqual({
      customerId: 'cus_1',
      subscriptionId: null,
    })
    m.invoicePaymentsList.mockResolvedValue({ data: [] })
    expect(await retrieveDisputeTarget(dispute({ customer: 'cus_1', payment_intent: 'pi_1' }))).toEqual({
      customerId: 'cus_1',
      subscriptionId: null,
    })
  })
  it('has no customer for a charge without one', async () => {
    expect(await retrieveDisputeTarget(dispute({ customer: null, payment_intent: null }))).toEqual({
      customerId: null,
      subscriptionId: null,
    })
  })
})

describe('prepareReferralAttach', () => {
  const page = <T,>(items: T[]) => ({ data: items, autoPagingToArray: async () => items })

  beforeEach(() => {
    m.customersSearch.mockReturnValue(page([{ id: 'cus_found' }]))
    m.subsList.mockResolvedValue({ data: [] })
    m.sessionsList.mockReturnValue(page([{ id: 'cs_open' }]))
  })

  it('expires the open full-price Checkout of a customer found only by metadata', async () => {
    expect(await prepareReferralAttach('tenant-1', null)).toEqual({ hasSubscription: false })
    expect(m.sessionsExpire).toHaveBeenCalledWith('cs_open')
  })

  it('reports a Stripe subscription whose webhook has not landed, and expires nothing', async () => {
    m.subsList.mockImplementation(async ({ customer }: { customer: string }) => ({ data: customer === 'cus_found' ? [{ id: 'sub_1' }] : [] }))
    expect(await prepareReferralAttach('tenant-1', 'cus_local')).toEqual({ hasSubscription: true })
    expect(m.sessionsExpire).not.toHaveBeenCalled()
  })
})

describe('referrerCouponsMatchTerms', () => {
  const byId: Record<string, number> = { c20: 20, c40: 40, c60: 60, c80: 80, c100: 100 }
  beforeEach(() => {
    m.couponsRetrieve.mockImplementation(async (id: string) => ({
      id, valid: true, percent_off: byId[id], amount_off: null, duration: 'forever', applies_to: null,
    }))
  })

  it('accepts ids in ascending percent order', async () => {
    expect(await referrerCouponsMatchTerms({ 20: 'c20', 40: 'c40', 60: 'c60', 80: 'c80', 100: 'c100' })).toBe(true)
  })

  it('rejects swapped ids, which would give 100% off for one referral', async () => {
    expect(await referrerCouponsMatchTerms({ 20: 'c100', 40: 'c40', 60: 'c60', 80: 'c80', 100: 'c20' })).toBe(false)
  })
})

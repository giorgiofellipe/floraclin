import { beforeEach, describe, expect, it, vi } from 'vitest'

const constructWebhookEventMock = vi.fn()
const referralMock = vi.fn()
const order: string[] = []

vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  constructWebhookEvent: (...a: unknown[]) => constructWebhookEventMock(...a),
  retrieveSubscription: vi.fn(),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  getPlanBySlug: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionPeriod: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))
// The local-row lookup finds nothing, so existing handlers run and return.
vi.mock('@/db/client', () => ({
  db: {
    select: () => {
      order.push('local')
      const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve([]) }
      return chain
    },
  },
}))
vi.mock('@/db/schema', () => ({ tenantSubscriptions: {}, plans: {} }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: () => new Response('error', { status: 500 }),
}))
vi.mock('@/lib/referral/events', () => ({
  handleReferralStripeEvent: (...a: unknown[]) => referralMock(...a),
}))

import { POST } from '../route'

function deliver(type: string, object: Record<string, unknown>) {
  const event = { type, data: { object } }
  constructWebhookEventMock.mockReturnValue(event)
  return event
}

function post() {
  const req = new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig' },
  })
  return POST(req as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  referralMock.mockImplementation(async () => {
    order.push('referral')
  })
})

describe('stripe webhook → referral events', () => {
  it.each([
    ['checkout.session.completed', { metadata: {} }],
    ['invoice.paid', { parent: { subscription_details: { subscription: 'sub_1' } } }],
    ['invoice.payment_failed', { parent: { subscription_details: { subscription: 'sub_1' } } }],
    ['customer.subscription.updated', { id: 'sub_1', status: 'active', items: { data: [] } }],
    ['customer.subscription.deleted', { id: 'sub_1' }],
    ['invoice.created', { id: 'in_1', status: 'draft', billing_reason: 'subscription_cycle' }],
    ['charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }],
  ])('hands %s to the referral module after the local handlers', async (type, object) => {
    const event = deliver(type, object)

    const res = await post()

    expect(res.status).toBe(200)
    expect(referralMock).toHaveBeenCalledTimes(1)
    expect(referralMock).toHaveBeenCalledWith(event)
    expect(order.at(-1)).toBe('referral')
    if (type !== 'invoice.created' && type !== 'charge.dispute.created' && type !== 'checkout.session.completed') {
      expect(order.indexOf('local')).toBeLessThan(order.indexOf('referral'))
    }
  })

  it('answers 500 when the referral module throws, so Stripe redelivers', async () => {
    deliver('invoice.paid', { parent: { subscription_details: { subscription: 'sub_1' } } })
    referralMock.mockRejectedValue(new Error('lock timeout'))

    expect((await post()).status).toBe(500)
  })

  it('keeps answering 200 with { received: true } when the module returns normally', async () => {
    deliver('customer.subscription.deleted', { id: 'sub_1' })

    const res = await post()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
  })

  it('does not reach the referral module for an invalid signature', async () => {
    constructWebhookEventMock.mockImplementation(() => {
      throw new Error('bad sig')
    })

    expect((await post()).status).toBe(400)
    expect(referralMock).not.toHaveBeenCalled()
  })
})

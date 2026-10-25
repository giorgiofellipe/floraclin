import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression: the paid conversion only reached Meta through the browser pixel on the billing page.

const sendSubscribeEventMock = vi.fn()
const constructWebhookEventMock = vi.fn()
const retrieveSubscriptionMock = vi.fn()
const getPlanBySlugMock = vi.fn()
const tenantRow = vi.fn()

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => task(),
}))
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  constructWebhookEvent: (...a: unknown[]) => constructWebhookEventMock(...a),
  retrieveSubscription: (...a: unknown[]) => retrieveSubscriptionMock(...a),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  getPlanBySlug: (...a: unknown[]) => getPlanBySlugMock(...a),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionPeriod: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))
vi.mock('@/db/client', () => {
  const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(tenantRow()) }
  return { db: { select: () => chain } }
})
vi.mock('@/lib/meta/events', () => ({ sendSubscribeEvent: (...a: unknown[]) => sendSubscribeEventMock(...a) }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ handleApiError: () => new Response('error', { status: 500 }) }))

import { POST } from '../route'

function deliver(subscriptionStatus: string) {
  constructWebhookEventMock.mockReturnValue({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        payment_status: 'paid',
        customer: 'cus_1',
        subscription: 'sub_1',
        customer_details: { email: 'maria@clinica.com' },
        metadata: { tenantId: 'tenant-1', planSlug: 'pro' },
      },
    },
  })
  retrieveSubscriptionMock.mockResolvedValue({ id: 'sub_1', status: subscriptionStatus, cancel_at_period_end: false, items: { data: [] } })
  const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'sig' } })
  return POST(req as never)
}

describe('checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlanBySlugMock.mockResolvedValue({ id: 'plan-pro', slug: 'pro', priceCents: 14990, active: true })
    tenantRow.mockReturnValue([
      { phone: '11999998888', signupAttribution: { fbclid: 'fb-click', capturedAt: '2026-10-06T00:00:00.000Z' } },
    ])
  })

  it('sends Subscribe under the pixel event id, with the signup ad click as fbc', async () => {
    await deliver('active')

    expect(sendSubscribeEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'subscribe:cs_test_1',
      email: 'maria@clinica.com',
      phone: '11999998888',
      fbc: 'fb.1.1791244800000.fb-click',
      valueCents: 14990,
      planSlug: 'pro',
    }))
  })

  it('sends nothing for a clinic whose owner objected to Meta conversion events', async () => {
    tenantRow.mockReturnValue([{ phone: null, signupAttribution: null, optedOutAt: new Date('2026-10-20T00:00:00.000Z') }])

    await deliver('active')

    expect(sendSubscribeEventMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the subscription is no longer active', async () => {
    await deliver('canceled')

    expect(sendSubscribeEventMock).not.toHaveBeenCalled()
  })
})

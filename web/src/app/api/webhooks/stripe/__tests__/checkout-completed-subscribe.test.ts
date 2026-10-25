import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression: the paid conversion only reached Meta through the browser pixel on the billing page.

const sendSubscribeEventMock = vi.fn()
const constructWebhookEventMock = vi.fn()
const retrieveSubscriptionMock = vi.fn()
const getPlanBySlugMock = vi.fn()
const tenantRow = vi.fn()

const afterTasks: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => void afterTasks.push(task()),
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

async function deliver(subscriptionStatus: string, { livemode = true } = {}) {
  constructWebhookEventMock.mockReturnValue({
    type: 'checkout.session.completed',
    created: 1792900000,
    data: {
      object: {
        id: 'cs_test_1',
        livemode,
        amount_total: 10493,
        payment_status: 'paid',
        customer: 'cus_1',
        subscription: 'sub_1',
        customer_details: { email: 'maria@clinica.com' },
        metadata: { tenantId: 'tenant-1', planSlug: 'pro', meta_ip: '203.0.113.7', meta_ua: 'Checkout Browser' },
      },
    },
  })
  retrieveSubscriptionMock.mockResolvedValue({ id: 'sub_1', status: subscriptionStatus, cancel_at_period_end: false, items: { data: [] } })
  const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'sig' } })
  const response = await POST(req as never)
  await Promise.all(afterTasks.splice(0))
  return response
}

describe('checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlanBySlugMock.mockResolvedValue({ id: 'plan-pro', slug: 'pro', priceCents: 14990, active: true })
    tenantRow.mockReturnValue([
      { phone: '11999998888', signupAttribution: { fbclid: 'fb-click', capturedAt: '2026-10-06T00:00:00.000Z' } },
    ])
  })

  it('sends Subscribe under the pixel event id, with the amount paid, the buyer browser and the signup ad click', async () => {
    await deliver('active')

    expect(sendSubscribeEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'subscribe:cs_test_1',
      eventTime: new Date(1792900000 * 1000),
      clientIp: '203.0.113.7',
      userAgent: 'Checkout Browser',
      email: 'maria@clinica.com',
      phone: '11999998888',
      fbc: 'fb.1.1791244800000.fb-click',
      paidCents: 10493,
      listPriceCents: 14990,
      planSlug: 'pro',
    }))
  })

  it('sends nothing for a clinic whose owner objected to Meta conversion events', async () => {
    tenantRow.mockReturnValue([{ phone: null, signupAttribution: null, optedOutAt: new Date('2026-10-20T00:00:00.000Z') }])

    await deliver('active')

    expect(sendSubscribeEventMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a test-mode checkout', { livemode: false }, undefined],
    ['a deleted clinic', {}, { phone: null, signupAttribution: null, deletedAt: new Date('2026-10-20T00:00:00.000Z') }],
  ])('sends nothing for %s', async (_name, options, row) => {
    if (row) tenantRow.mockReturnValue([row])

    await deliver('active', options)

    expect(sendSubscribeEventMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the subscription is no longer active', async () => {
    await deliver('canceled')

    expect(sendSubscribeEventMock).not.toHaveBeenCalled()
  })
})

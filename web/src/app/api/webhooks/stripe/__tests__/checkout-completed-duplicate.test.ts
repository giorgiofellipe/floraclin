import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  getStripeSubscriptionState: vi.fn(),
  cancelStripeSubscriptionNow: vi.fn(),
  getSubscription: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  clearCheckoutSessionId: vi.fn(),
  report: vi.fn(),
}))

vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  constructWebhookEvent: m.constructWebhookEvent,
  retrieveSubscription: m.retrieveSubscription,
  getStripeSubscriptionState: m.getStripeSubscriptionState,
  cancelStripeSubscriptionNow: m.cancelStripeSubscriptionNow,
}))
vi.mock('@/db/queries/subscriptions', () => ({
  clearCheckoutSessionId: m.clearCheckoutSessionId,
  getSubscription: m.getSubscription,
  getPlanBySlug: vi.fn(async () => ({ id: 'plan-pro', slug: 'pro', priceCents: 19900, active: true })),
  updateSubscriptionPlan: m.updateSubscriptionPlan,
  updateSubscriptionPeriod: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/lib/meta/platform-conversions', () => ({ scheduleSubscribeConversion: vi.fn() }))
vi.mock('@/lib/referral/events', () => ({ handleReferralStripeEvent: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: m.report }))
vi.mock('@/lib/api-error', () => ({ handleApiError: () => new Response('error', { status: 500 }) }))

import { POST } from '../route'

function deliver(type: string) {
  m.constructWebhookEvent.mockReturnValue({
    id: 'evt_1',
    type,
    created: 1792900000,
    data: {
      object: {
        id: 'cs_2',
        payment_status: 'paid',
        customer: 'cus_1',
        subscription: 'sub_new',
        metadata: { tenantId: 'tenant-1', planSlug: 'pro' },
      },
    },
  })
  const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'sig' } })
  return POST(req as never)
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.retrieveSubscription.mockResolvedValue({ id: 'sub_new', status: 'active', cancel_at_period_end: false, items: { data: [] } })
  m.getSubscription.mockResolvedValue({ tenantId: 'tenant-1', stripeSubscriptionId: 'sub_live' })
})

describe('checkout.session.completed for a tenant that already has a subscription', () => {
  // Regression: a second paid checkout overwrote the row's live subscription id, and the old one billed unseen.
  it('keeps the live subscription and cancels the new one, reporting it', async () => {
    m.getStripeSubscriptionState.mockResolvedValue('live')

    const res = await deliver('checkout.session.completed')

    expect(res.status).toBe(200)
    expect(m.cancelStripeSubscriptionNow).toHaveBeenCalledWith('sub_new')
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
    expect(m.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'duplicate_subscription', extra: { tenantId: 'tenant-1', kept: 'sub_live', cancelled: 'sub_new' } }),
    )
  })

  it.each(['pending_cancel', 'ended'] as const)('stores the new one when the old one is %s (it will not bill again)', async (state) => {
    m.getStripeSubscriptionState.mockResolvedValue(state)

    await deliver('checkout.session.completed')

    expect(m.cancelStripeSubscriptionNow).not.toHaveBeenCalled()
    expect(m.updateSubscriptionPlan).toHaveBeenCalledWith('tenant-1', 'plan-pro', 'stripe', expect.objectContaining({ stripeSubscriptionId: 'sub_new' }))
  })
})

describe('stored checkout session', () => {
  it.each(['checkout.session.completed', 'checkout.session.expired'])('is forgotten on %s', async (type) => {
    m.getStripeSubscriptionState.mockResolvedValue('ended')

    await deliver(type)

    expect(m.clearCheckoutSessionId).toHaveBeenCalledWith('tenant-1', 'cs_2')
  })
})

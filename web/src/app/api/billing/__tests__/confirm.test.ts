import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  retrieveCheckoutSession: vi.fn(),
}))

vi.mock('@/db/queries/subscriptions', () => ({
  getPlanBySlug: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { getAuthContext } from '@/lib/auth'
import { retrieveCheckoutSession } from '@/lib/stripe'
import { getPlanBySlug, updateSubscriptionPlan } from '@/db/queries/subscriptions'
import { POST } from '../confirm/route'
import type Stripe from 'stripe'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/billing/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const PERIOD_START = new Date('2026-09-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-10-01T00:00:00.000Z')

const SAMPLE_PLAN = {
  id: 'plan-1',
  slug: 'pro',
  name: 'Pro',
  priceCents: 9900,
  billingInterval: 'month',
  trialDays: null,
  stripePriceId: 'price_123',
  limits: {},
  features: {},
  displayOrder: 0,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeSession(overrides?: {
  paymentStatus?: string
  tenantId?: string | null
  planSlug?: string
  subscription?: Partial<Stripe.Subscription> | string | null
}): Stripe.Response<Stripe.Checkout.Session> {
  const subscription =
    overrides?.subscription === undefined
      ? {
          id: 'sub_123',
          status: 'active',
          customer: 'cus_123',
          items: {
            data: [
              {
                current_period_start: PERIOD_START.getTime() / 1000,
                current_period_end: PERIOD_END.getTime() / 1000,
              },
            ],
          },
        }
      : overrides.subscription

  return {
    id: 'cs_test_123',
    payment_status: overrides?.paymentStatus ?? 'paid',
    metadata: {
      tenantId: overrides?.tenantId === undefined ? 'tenant-1' : (overrides.tenantId ?? undefined),
      planSlug: overrides?.planSlug ?? 'pro',
    },
    subscription,
    customer: 'cus_123',
  } as unknown as Stripe.Response<Stripe.Checkout.Session>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
    email: 'owner@example.com',
    fullName: 'Owner Example',
    isPlatformAdmin: false,
  })
  vi.mocked(getPlanBySlug).mockResolvedValue(SAMPLE_PLAN as never)
  vi.mocked(updateSubscriptionPlan).mockResolvedValue(undefined as never)
})

describe('POST /api/billing/confirm', () => {
  it('stores the billing period from the subscription', async () => {
    // Without this the row keeps whatever boundary it had, which for someone
    // buying after an expired trial is a date in the past: they read as
    // lapsed the moment they cancel, and reactivation refuses them.
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(makeSession())

    await POST(makeRequest({ sessionId: 'cs_test_123' }))

    expect(updateSubscriptionPlan).toHaveBeenCalledWith(
      'tenant-1',
      'plan-1',
      'stripe',
      expect.objectContaining({
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
      }),
    )
  })

  it('activates a paid session for the caller tenant with a live subscription', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(makeSession())

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: true })
    expect(updateSubscriptionPlan).toHaveBeenCalledWith(
      'tenant-1',
      'plan-1',
      'stripe',
      expect.objectContaining({
        status: 'active',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
      }),
    )
  })

  it('returns 403 for a non-owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'practitioner',
      email: 'p@example.com',
      fullName: 'Practitioner',
      isPlatformAdmin: false,
    })

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))

    expect(res.status).toBe(403)
    expect(retrieveCheckoutSession).not.toHaveBeenCalled()
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('returns 400 when sessionId is missing', async () => {
    const res = await POST(makeRequest({}))

    expect(res.status).toBe(400)
    expect(retrieveCheckoutSession).not.toHaveBeenCalled()
  })

  it('does not activate an unpaid session', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(
      makeSession({ paymentStatus: 'unpaid' }),
    )

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: false })
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('returns 403 when the session metadata.tenantId belongs to another tenant', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(
      makeSession({ tenantId: 'other-tenant' }),
    )

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))

    expect(res.status).toBe(403)
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('does not activate when the expanded subscription is canceled (replay guard)', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(
      makeSession({ subscription: { id: 'sub_123', status: 'canceled', customer: 'cus_123' } }),
    )

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: false })
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('does not activate when subscription is not expanded (string id only)', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(
      makeSession({ subscription: 'sub_123' }),
    )

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: false })
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('does not activate when the plan is missing', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(makeSession())
    vi.mocked(getPlanBySlug).mockResolvedValue(null)

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: false })
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('does not activate when the plan is inactive', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(makeSession())
    vi.mocked(getPlanBySlug).mockResolvedValue({ ...SAMPLE_PLAN, active: false } as never)

    const res = await POST(makeRequest({ sessionId: 'cs_test_123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ activated: false })
    expect(updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('writes the same plan and ids on a replay, so a second call cannot change the outcome', async () => {
    vi.mocked(retrieveCheckoutSession).mockResolvedValue(makeSession())

    await POST(makeRequest({ sessionId: 'cs_test_123' }))
    await POST(makeRequest({ sessionId: 'cs_test_123' }))

    expect(updateSubscriptionPlan).toHaveBeenCalledTimes(2)
    expect(updateSubscriptionPlan).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'plan-1',
      'stripe',
      expect.objectContaining({
        status: 'active',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
      }),
    )
    expect(updateSubscriptionPlan).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      'plan-1',
      'stripe',
      expect.objectContaining({
        status: 'active',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
      }),
    )
  })
})

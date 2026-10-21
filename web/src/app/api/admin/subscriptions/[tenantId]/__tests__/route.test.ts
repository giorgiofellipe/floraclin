import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getPlanBySlug: vi.fn(),
  updateSubscriptionPeriod: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: vi.fn(async () => ({ userId: 'admin-1' })) }))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: m.getSubscription,
  getPlanBySlug: m.getPlanBySlug,
  updateSubscriptionPeriod: m.updateSubscriptionPeriod,
  updateSubscriptionPlan: m.updateSubscriptionPlan,
  updateSubscriptionStatus: m.updateSubscriptionStatus,
}))
vi.mock('@/db/queries/whatsapp-credits', () => ({ getCreditUsage: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: m.createAuditLog }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: (e: unknown) => {
    throw e
  },
}))

import { PATCH } from '../route'

const PAST = new Date(Date.now() - 3 * 86_400_000)
const FUTURE = new Date(Date.now() + 30 * 86_400_000)
const STARTER = { id: 'p-starter', slug: 'starter' }
const PRO = { id: 'p-pro', slug: 'pro' }

function row(over: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    status: 'expired',
    source: 'gift',
    currentPeriodStart: new Date(PAST.getTime() - 30 * 86_400_000),
    currentPeriodEnd: PAST,
    plan: STARTER,
    ...over,
  }
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request('http://x/api/admin/subscriptions/t1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ tenantId: 't1' }) },
  )
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getPlanBySlug.mockImplementation(async (slug: string) => (slug === 'pro' ? PRO : STARTER))
  m.updateSubscriptionStatus.mockImplementation(async (_t: string, status: string) => row({ status }))
  m.updateSubscriptionPeriod.mockImplementation(async (_t: string, p: Record<string, unknown>) => row({ ...p, status: 'active' }))
  m.updateSubscriptionPlan.mockImplementation(async () => row({ status: 'active', currentPeriodEnd: FUTURE }))
})

describe('PATCH /api/admin/subscriptions/[tenantId]', () => {
  it('refuses to reactivate a lapsed gift without a new end date (it would stay locked)', async () => {
    m.getSubscription.mockResolvedValue(row())
    const res = await patch({ status: 'active' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('period_end_required')
    expect(m.updateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('refuses a plan change on a lapsed active grant without a new end date', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'admin' }))
    const res = await patch({ planSlug: 'pro' })
    expect(res.status).toBe(400)
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('reactivates with the new end date and audits it', async () => {
    m.getSubscription.mockResolvedValue(row())
    const res = await patch({ status: 'active', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(200)
    expect(m.updateSubscriptionStatus).toHaveBeenCalledWith('t1', 'active')
    expect(m.updateSubscriptionPeriod).toHaveBeenCalledWith('t1', expect.objectContaining({ currentPeriodEnd: FUTURE }))
    expect(m.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ currentPeriodEnd: { old: PAST, new: FUTURE } }),
      }),
    )
  })

  it('rejects an end date in the past', async () => {
    m.getSubscription.mockResolvedValue(row())
    const res = await patch({ status: 'active', currentPeriodEnd: PAST.toISOString() })
    expect(res.status).toBe(400)
  })

  it('refuses a plan change on a Stripe subscription: the plan is the Stripe price', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'stripe', currentPeriodEnd: FUTURE }))
    const res = await patch({ planSlug: 'pro', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_plan_change')
    expect(body.error).toMatch(/Stripe ou pelo portal de cobrança/)
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('refuses to reactivate a cancelled Stripe row without a new end date, even mid-period', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled', source: 'stripe', currentPeriodEnd: FUTURE }))
    const res = await patch({ status: 'active' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('period_end_required')
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
    expect(m.updateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('turns a reactivated Stripe row into an admin grant ending on the new date', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled', source: 'stripe', currentPeriodEnd: PAST }))
    const res = await patch({ status: 'active', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(200)
    // One write: no Stripe-driven `active` row with nothing behind it.
    expect(m.updateSubscriptionPlan).toHaveBeenCalledWith('t1', 'p-starter', 'admin', {
      status: 'active',
      currentPeriodEnd: FUTURE,
    })
    expect(m.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ source: { old: 'stripe', new: 'admin' } }) }),
    )
  })

  it('still lets an admin cancel a Stripe row', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'stripe', currentPeriodEnd: FUTURE }))
    const res = await patch({ status: 'canceled' })
    expect(res.status).toBe(200)
    expect(m.updateSubscriptionStatus).toHaveBeenCalledWith('t1', 'canceled')
  })

  it('lets an admin expire a lapsed grant without asking for a date', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'gift' }))
    const res = await patch({ status: 'expired' })
    expect(res.status).toBe(200)
  })
})

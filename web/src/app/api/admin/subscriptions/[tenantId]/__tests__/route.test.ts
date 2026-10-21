import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getPlanBySlug: vi.fn(),
  updateSubscriptionPeriod: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
  createAuditLog: vi.fn(),
  getStripeSubscriptionState: vi.fn(),
  report: vi.fn(),
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
vi.mock('@/lib/stripe', () => ({ getStripeSubscriptionState: m.getStripeSubscriptionState }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: m.report }))
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
  m.getStripeSubscriptionState.mockResolvedValue('pending_cancel')
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

  it('refuses to reactivate a Stripe row whose paid period is still open, pointing to the billing portal', async () => {
    m.getSubscription.mockResolvedValue(
      // 02:00 UTC is still the 9th in São Paulo.
      row({
        status: 'canceled',
        source: 'stripe',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: new Date('2099-03-10T02:00:00.000Z'),
      }),
    )
    const res = await patch({ status: 'active', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_period_open')
    expect(body.error).toBe(
      'Esta clínica ainda tem acesso pago até 09/03/2099. Ela pode retomar a assinatura pelo portal de cobrança (Configurações › Assinatura).',
    )
    expect(m.getStripeSubscriptionState).toHaveBeenCalledWith('sub_1')
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
    expect(m.updateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('lets an admin reactivate, as a grant, a Stripe row whose subscription Stripe already ended mid-period', async () => {
    m.getStripeSubscriptionState.mockResolvedValue('ended')
    m.getSubscription.mockResolvedValue(
      row({ status: 'canceled', source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: FUTURE }),
    )
    const res = await patch({ status: 'active', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(200)
    expect(m.updateSubscriptionPlan).toHaveBeenCalledWith('t1', 'p-starter', 'admin', {
      status: 'active',
      currentPeriodEnd: FUTURE,
    })
  })

  it.each([
    ['still billing (resumed before our webhook caught up)', 'live', FUTURE],
    ['set to cancel, with our period already past (not synced)', 'pending_cancel', PAST],
  ])('refuses to reactivate a Stripe row whose subscription is %s', async (_name, state, end) => {
    m.getStripeSubscriptionState.mockResolvedValue(state)
    m.getSubscription.mockResolvedValue(
      row({ status: 'canceled', source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: end }),
    )
    const res = await patch({ status: 'active', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_still_active')
    expect(body.error).toMatch(/ainda está ativa no Stripe/)
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('refuses a reactivation with a 503 when Stripe cannot say whether the cancellation is pending', async () => {
    m.getStripeSubscriptionState.mockRejectedValue(new Error('stripe down'))
    m.getSubscription.mockResolvedValue(
      row({ status: 'expired', source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: FUTURE }),
    )
    const res = await patch({ status: 'trialing', currentPeriodEnd: FUTURE.toISOString() })
    expect(res.status).toBe(503)
    expect(m.report).toHaveBeenCalled()
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('reports a plan change before an open period on a Stripe row', async () => {
    m.getSubscription.mockResolvedValue(
      row({ status: 'canceled', source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: FUTURE }),
    )
    const res = await patch({ planSlug: 'pro', status: 'active' })
    expect((await res.json()).code).toBe('stripe_plan_change')
    expect(m.getStripeSubscriptionState).not.toHaveBeenCalled()
  })

  it.each([
    ['active', { status: 'active' }],
    ['past_due', { status: 'past_due' }],
    ['already cancelled', { status: 'canceled' }],
  ])('refuses to move the end date of a %s Stripe row', async (_name, over) => {
    m.getSubscription.mockResolvedValue(row({ ...over, source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: FUTURE }))
    const res = await patch({ status: over.status, currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString() })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('stripe_period_change')
    expect(m.updateSubscriptionPeriod).not.toHaveBeenCalled()
  })

  it('refuses to reactivate a lapsed cancelled Stripe row without a new end date', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled', source: 'stripe', currentPeriodEnd: PAST }))
    const res = await patch({ status: 'active' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('period_end_required')
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
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

  it.each([
    ['active', 'canceled'],
    ['active', 'expired'],
    ['canceled', 'expired'],
  ])('refuses to move a Stripe row from %s to %s: only Stripe stops the charges', async (from, status) => {
    m.getSubscription.mockResolvedValue(row({ status: from, source: 'stripe', currentPeriodEnd: FUTURE }))
    const res = await patch({ status })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_cancel')
    expect(body.error).toMatch(/painel do Stripe ou pelo portal de cobrança/)
    expect(m.updateSubscriptionStatus).not.toHaveBeenCalled()
    expect(m.createAuditLog).not.toHaveBeenCalled()
  })

  it.each([
    ['past_due', 'active'],
    ['active', 'past_due'],
    ['past_due', 'trialing'],
    ['canceled', 'past_due'],
    ['active', 'trialing'],
  ])('refuses a manual %s → %s on a Stripe row: Stripe controls the status', async (from, to) => {
    m.getSubscription.mockResolvedValue(
      row({ status: from, source: 'stripe', stripeSubscriptionId: 'sub_1', currentPeriodEnd: FUTURE }),
    )
    const res = await patch({ status: to })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_status')
    expect(body.error).toMatch(/controlado pelo Stripe/)
    expect(m.updateSubscriptionStatus).not.toHaveBeenCalled()
    expect(m.updateSubscriptionPlan).not.toHaveBeenCalled()
  })

  it('does not ask Stripe for a status change that is not a reactivation', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'past_due', source: 'stripe', stripeSubscriptionId: 'sub_1' }))
    const res = await patch({ status: 'active' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('stripe_status')
    expect(m.getStripeSubscriptionState).not.toHaveBeenCalled()
  })

  it('still lets an admin move a grant between statuses', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'admin', currentPeriodEnd: FUTURE }))
    const res = await patch({ status: 'past_due' })
    expect(res.status).toBe(200)
  })

  it('still lets an admin cancel a grant', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'active', source: 'admin', currentPeriodEnd: FUTURE }))
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

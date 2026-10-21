import { beforeEach, describe, expect, it, vi } from 'vitest'

// Gift and trial extension rewrite the row; on a Stripe subscription that
// Stripe still bills, that would leave the clinic charged for a plan our row
// no longer follows.
const m = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getPlanBySlug: vi.fn(),
  giftSubscription: vi.fn(),
  extendTrial: vi.fn(),
  createAuditLog: vi.fn(),
  getStripeSubscriptionState: vi.fn(),
  report: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: vi.fn(async () => ({ userId: 'admin-1' })) }))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: m.getSubscription,
  getPlanBySlug: m.getPlanBySlug,
  giftSubscription: m.giftSubscription,
  extendTrial: m.extendTrial,
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: m.createAuditLog }))
vi.mock('@/lib/stripe', () => ({ getStripeSubscriptionState: m.getStripeSubscriptionState }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: m.report }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: (e: unknown) => {
    throw e
  },
}))

import { POST as gift } from '../gift/route'
import { POST as extend } from '../extend-trial/route'

const FUTURE = new Date(Date.now() + 30 * 86_400_000)

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-row',
    tenantId: 't1',
    status: 'active',
    source: 'stripe',
    stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: FUTURE,
    plan: { id: 'p-starter', slug: 'starter' },
    giftedMonths: null,
    notes: null,
    ...over,
  }
}

const params = { params: Promise.resolve({ tenantId: 't1' }) }
const post = (body: Record<string, unknown>) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getPlanBySlug.mockResolvedValue({ id: 'p-pro', slug: 'pro' })
  m.giftSubscription.mockResolvedValue(row({ source: 'gift' }))
  m.extendTrial.mockResolvedValue(row({ source: 'trial', status: 'trialing' }))
})

describe('POST gift on a Stripe row', () => {
  it.each(['live', 'pending_cancel'])('refuses while Stripe says the subscription is %s', async (state) => {
    m.getSubscription.mockResolvedValue(row())
    m.getStripeSubscriptionState.mockResolvedValue(state)
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('stripe_gift')
    expect(body.error).toMatch(/assinatura ativa no Stripe/)
    expect(m.getStripeSubscriptionState).toHaveBeenCalledWith('sub_1')
    expect(m.giftSubscription).not.toHaveBeenCalled()
  })

  it('says until when a cancelled-at-period-end subscription still runs', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled', currentPeriodEnd: new Date('2099-03-10T02:00:00.000Z') }))
    m.getStripeSubscriptionState.mockResolvedValue('pending_cancel')
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect((await res.json()).error).toBe(
      'A assinatura desta clínica no Stripe já está cancelada e termina em 09/03/2099. Presenteie depois dessa data ou encerre a assinatura agora no painel do Stripe.',
    )
  })

  it('gifts a Stripe row with no subscription id: nothing at Stripe to keep charging', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled', stripeSubscriptionId: null }))
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect(res.status).toBe(200)
    expect(m.getStripeSubscriptionState).not.toHaveBeenCalled()
  })

  it('gifts once Stripe confirms the subscription ended', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'canceled' }))
    m.getStripeSubscriptionState.mockResolvedValue('ended')
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect(res.status).toBe(200)
    expect(m.giftSubscription).toHaveBeenCalled()
  })

  it('answers 503 and writes nothing when Stripe cannot be reached', async () => {
    m.getSubscription.mockResolvedValue(row())
    m.getStripeSubscriptionState.mockRejectedValue(new Error('stripe down'))
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect(res.status).toBe(503)
    expect(m.report).toHaveBeenCalled()
    expect(m.giftSubscription).not.toHaveBeenCalled()
  })

  it('does not ask Stripe for a row that is not billed there', async () => {
    m.getSubscription.mockResolvedValue(row({ source: 'trial', stripeSubscriptionId: null, status: 'expired' }))
    const res = await gift(post({ planSlug: 'pro', months: 3 }), params)
    expect(res.status).toBe(200)
    expect(m.getStripeSubscriptionState).not.toHaveBeenCalled()
  })
})

describe('POST extend-trial on a Stripe row', () => {
  it('refuses: Stripe owns the trial end', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'trialing' }))
    const res = await extend(post({ days: 7 }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('stripe_period_change')
    expect(m.extendTrial).not.toHaveBeenCalled()
  })

  it('still extends a regular trial', async () => {
    m.getSubscription.mockResolvedValue(row({ status: 'trialing', source: 'trial', stripeSubscriptionId: null }))
    const res = await extend(post({ days: 7 }), params)
    expect(res.status).toBe(200)
    expect(m.extendTrial).toHaveBeenCalledWith('t1', 7)
  })
})

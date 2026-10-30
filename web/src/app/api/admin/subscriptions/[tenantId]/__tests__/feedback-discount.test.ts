import { beforeEach, describe, expect, it, vi } from 'vitest'

// The feedback reward flag makes the tenant's next checkout 50% off for 3
// months. Only a platform admin may set it, every change is audited, and a
// clinic checkout would never discount (one Stripe bills) cannot be flagged.
const m = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  getSubscription: vi.fn(),
  grantFeedbackDiscount: vi.fn(),
  clearFeedbackDiscount: vi.fn(),
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: m.requirePlatformAdmin }))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: m.getSubscription,
  grantFeedbackDiscount: m.grantFeedbackDiscount,
  clearFeedbackDiscount: m.clearFeedbackDiscount,
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: m.createAuditLog }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn(), maskPath: (p: string) => p }))

import { ForbiddenError } from '@/lib/errors'
import { DELETE, POST } from '../feedback-discount/route'

const FUTURE = new Date(Date.now() + 5 * 86_400_000)
const PAST = new Date(Date.now() - 5 * 86_400_000)
const GRANTED_AT = new Date('2026-10-29T15:00:00.000Z')

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-row',
    tenantId: 't1',
    status: 'trialing',
    source: 'trial',
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    firstPaidAt: null,
    currentPeriodEnd: FUTURE,
    feedbackDiscountGrantedAt: null,
    feedbackDiscountGrantedBy: null,
    plan: { id: 'p-trial', slug: 'trial' },
    ...over,
  }
}

const params = { params: Promise.resolve({ tenantId: 't1' }) }
const req = (method: string) => new Request('http://x/api/admin/subscriptions/t1/feedback-discount', { method })

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.requirePlatformAdmin.mockResolvedValue({ userId: 'admin-1' })
  m.grantFeedbackDiscount.mockImplementation(async () =>
    row({ feedbackDiscountGrantedAt: GRANTED_AT, feedbackDiscountGrantedBy: 'admin-1' }),
  )
  m.clearFeedbackDiscount.mockImplementation(async () => row())
})

describe('feedback-discount auth', () => {
  it.each([
    ['POST', POST],
    ['DELETE', DELETE],
  ] as const)('%s answers 403 for a non-admin and writes nothing', async (method, handler) => {
    m.requirePlatformAdmin.mockRejectedValue(new ForbiddenError('Forbidden: not platform admin'))
    m.getSubscription.mockResolvedValue(row({ feedbackDiscountGrantedAt: GRANTED_AT }))
    const res = await handler(req(method), params)
    expect(res.status).toBe(403)
    expect(m.grantFeedbackDiscount).not.toHaveBeenCalled()
    expect(m.clearFeedbackDiscount).not.toHaveBeenCalled()
    expect(m.createAuditLog).not.toHaveBeenCalled()
  })
})

describe('POST feedback-discount', () => {
  it.each([
    ['a running trial', row()],
    ['a trial that ended (read-only)', row({ status: 'expired', currentPeriodEnd: PAST })],
  ])('flags %s and audits who did it', async (_, existing) => {
    m.getSubscription.mockResolvedValue(existing)
    const res = await POST(req('POST'), params)
    expect(res.status).toBe(200)
    expect(m.grantFeedbackDiscount).toHaveBeenCalledWith('t1', 'admin-1')
    expect(m.createAuditLog).toHaveBeenCalledWith({
      tenantId: 't1',
      userId: 'admin-1',
      action: 'update',
      entityType: 'subscription',
      entityId: 'sub-row',
      changes: {
        feedbackDiscountGrantedAt: { old: null, new: GRANTED_AT },
        feedbackDiscountGrantedBy: { old: null, new: 'admin-1' },
      },
    })
  })

  it.each([
    ['an active Stripe subscription', { source: 'stripe', status: 'active', stripeSubscriptionId: 'sub_1' }],
    ['a past_due Stripe subscription', { source: 'stripe', status: 'past_due', stripeSubscriptionId: 'sub_1' }],
    ['a clinic that has paid before', { status: 'expired', currentPeriodEnd: PAST, firstPaidAt: PAST }],
  ])('refuses %s with 409', async (_, over) => {
    m.getSubscription.mockResolvedValue(row(over))
    const res = await POST(req('POST'), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('feedback_discount_stripe')
    expect(body.error).toMatch(/assinatura paga no Stripe/)
    expect(m.grantFeedbackDiscount).not.toHaveBeenCalled()
    expect(m.createAuditLog).not.toHaveBeenCalled()
  })

  it('refuses a gift row: checkout would never apply the discount there', async () => {
    m.getSubscription.mockResolvedValue(row({ source: 'gift', status: 'active' }))
    const res = await POST(req('POST'), params)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('feedback_discount_not_trial')
    expect(m.grantFeedbackDiscount).not.toHaveBeenCalled()
  })

  it('keeps the original grant when already flagged, without a second audit entry', async () => {
    m.getSubscription.mockResolvedValue(row({ feedbackDiscountGrantedAt: GRANTED_AT, feedbackDiscountGrantedBy: 'admin-0' }))
    const res = await POST(req('POST'), params)
    expect(res.status).toBe(200)
    expect((await res.json()).data.feedbackDiscountGrantedBy).toBe('admin-0')
    expect(m.grantFeedbackDiscount).not.toHaveBeenCalled()
    expect(m.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers 404 for a tenant without a subscription row', async () => {
    m.getSubscription.mockResolvedValue(null)
    expect((await POST(req('POST'), params)).status).toBe(404)
  })
})

describe('DELETE feedback-discount', () => {
  it('clears the flag and audits the old values', async () => {
    m.getSubscription.mockResolvedValue(row({ feedbackDiscountGrantedAt: GRANTED_AT, feedbackDiscountGrantedBy: 'admin-0' }))
    const res = await DELETE(req('DELETE'), params)
    expect(res.status).toBe(200)
    expect(m.clearFeedbackDiscount).toHaveBeenCalledWith('t1')
    expect(m.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        entityId: 'sub-row',
        changes: {
          feedbackDiscountGrantedAt: { old: GRANTED_AT, new: null },
          feedbackDiscountGrantedBy: { old: 'admin-0', new: null },
        },
      }),
    )
  })

  it('clears even on a Stripe row, so a stale flag can always be removed', async () => {
    m.getSubscription.mockResolvedValue(
      row({ source: 'stripe', status: 'active', stripeSubscriptionId: 'sub_1', feedbackDiscountGrantedAt: GRANTED_AT }),
    )
    expect((await DELETE(req('DELETE'), params)).status).toBe(200)
    expect(m.clearFeedbackDiscount).toHaveBeenCalled()
  })

  it('writes no audit entry when there was nothing to clear', async () => {
    m.getSubscription.mockResolvedValue(row())
    m.clearFeedbackDiscount.mockResolvedValue(null)
    expect((await DELETE(req('DELETE'), params)).status).toBe(200)
    expect(m.createAuditLog).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

const m = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  getReferralById: vi.fn(),
  markReferralIneligible: vi.fn(),
  createAuditLog: vi.fn(),
  syncReferrerReward: vi.fn(),
  announce: vi.fn(),
  captureException: vi.fn(() => 'evt'),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: m.captureException }))
vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: m.requirePlatformAdmin }))
vi.mock('@/db/queries/referrals', () => ({
  getReferralById: m.getReferralById,
  markReferralIneligible: m.markReferralIneligible,
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: m.createAuditLog }))
vi.mock('@/lib/referral/reward', () => ({ syncReferrerReward: m.syncReferrerReward }))
vi.mock('@/lib/referral/announce', () => ({ announceReferralStatusChange: m.announce }))

import { POST } from '../route'

const post = (body: unknown = {}) =>
  POST(
    new Request('http://x/api/admin/referrals/r1/ineligible', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'r1' }) },
  )

const ROW = { id: 'r1', status: 'counting', referrerTenantId: 'ref-1', referredTenantId: 'red-1' }

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.captureException.mockReturnValue('evt')
  m.requirePlatformAdmin.mockResolvedValue({ userId: 'admin-1' })
  m.getReferralById.mockResolvedValue(ROW)
  m.markReferralIneligible.mockResolvedValue({ ...ROW, status: 'ineligible' })
  m.createAuditLog.mockResolvedValue(undefined)
  m.syncReferrerReward.mockResolvedValue({ skipped: 'not_configured' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/referrals/[id]/ineligible', () => {
  it('rejects a non-admin before touching anything', async () => {
    m.requirePlatformAdmin.mockRejectedValue(new ForbiddenError('Forbidden: not platform admin'))
    const res = await post()
    expect(res.status).toBe(403)
    expect(m.markReferralIneligible).not.toHaveBeenCalled()
  })

  it('marks, audits and syncs the referrer, in that order', async () => {
    const order: string[] = []
    m.markReferralIneligible.mockImplementation(async () => (order.push('mark'), { ...ROW, status: 'ineligible' }))
    m.createAuditLog.mockImplementation(async () => void order.push('audit'))
    m.syncReferrerReward.mockImplementation(async () => (order.push('sync'), { skipped: 'not_configured' }))

    const res = await post({ note: '  fraude  ' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { status: 'ineligible' } })
    expect(order).toEqual(['mark', 'audit', 'sync'])
    expect(m.markReferralIneligible).toHaveBeenCalledWith('r1', 'admin', 'fraude')
    expect(m.announce).toHaveBeenCalledWith(ROW, { ...ROW, status: 'ineligible' }, { note: 'fraude' })
    expect(m.createAuditLog).toHaveBeenCalledWith({
      tenantId: 'red-1',
      userId: 'admin-1',
      action: 'update',
      entityType: 'tenant_referral',
      entityId: 'r1',
      changes: { status: { old: 'counting', new: 'ineligible' } },
    })
    expect(m.syncReferrerReward).toHaveBeenCalledWith('ref-1', { reason: 'admin', referralId: 'r1' })
  })

  it('accepts an empty body (no note)', async () => {
    const res = await POST(
      new Request('http://x/y', { method: 'POST' }),
      { params: Promise.resolve({ id: 'r1' }) },
    )
    expect(res.status).toBe(200)
    expect(m.markReferralIneligible).toHaveBeenCalledWith('r1', 'admin', undefined)
  })

  it('rejects a note over 500 characters', async () => {
    const res = await post({ note: 'x'.repeat(501) })
    expect(res.status).toBe(400)
    expect(m.markReferralIneligible).not.toHaveBeenCalled()
  })

  it('404s when the referral does not exist', async () => {
    m.getReferralById.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(404)
    expect(m.markReferralIneligible).not.toHaveBeenCalled()
    expect(m.syncReferrerReward).not.toHaveBeenCalled()
  })

  it('409s when it is already ineligible, without audit or sync', async () => {
    m.markReferralIneligible.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(409)
    expect(m.createAuditLog).not.toHaveBeenCalled()
    expect(m.syncReferrerReward).not.toHaveBeenCalled()
  })

  it('answers 200 and reports when the sync throws, with the mark and audit already done', async () => {
    m.syncReferrerReward.mockRejectedValue(new Error('stripe down'))
    const res = await post()
    expect(res.status).toBe(200)
    expect(m.captureException).toHaveBeenCalledTimes(1)
    expect(m.markReferralIneligible).toHaveBeenCalledTimes(1)
    expect(m.createAuditLog).toHaveBeenCalledTimes(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

const m = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  getTenantReferralAdminView: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: m.requirePlatformAdmin }))
vi.mock('@/db/queries/referrals', () => ({ getTenantReferralAdminView: m.getTenantReferralAdminView }))

import { GET } from '../route'

const call = () =>
  GET(new Request('http://x/api/admin/tenants/t1/referrals'), { params: Promise.resolve({ id: 't1' }) })

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
  m.requirePlatformAdmin.mockResolvedValue({ userId: 'admin-1' })
})

describe('GET /api/admin/tenants/[id]/referrals', () => {
  it('rejects a non-admin without reading anything', async () => {
    m.requirePlatformAdmin.mockRejectedValue(new ForbiddenError('Forbidden: not platform admin'))
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.getTenantReferralAdminView).not.toHaveBeenCalled()
  })

  it('returns the admin view, checks included, under data', async () => {
    const view = {
      code: 'MECA7K',
      referredBy: null,
      referrals: [{ id: 'r1', referredName: 'Clínica A', checks: { atSignup: { selfReferral: [], notNew: [] } } }],
      events: [],
    }
    m.getTenantReferralAdminView.mockResolvedValue(view)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: view })
    expect(m.getTenantReferralAdminView).toHaveBeenCalledWith('t1')
  })
})

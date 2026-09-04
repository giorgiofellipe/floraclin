import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan limits were data only. `checkPlanLimit` and `checkPlanFeature` both
 * existed, computed the right answer, and had zero callers, so the only thing
 * a paid plan actually bought was WhatsApp volume, which is enforced
 * separately through the credits table.
 *
 * These two call sites are the whole enforcement surface, so they are worth
 * pinning:
 *
 *   - seats, refused on invite
 *   - own WhatsApp number, refused on the settings write
 *
 * The second was the exploitable one. It was guarded only by a `disabled`
 * prop on a radio button, while the route took `whatsapp_mode` straight from
 * the request body. `getTemplateForTenant` branches on that value, so a free
 * tenant could move itself onto its own Meta credentials with one request.
 */

const checkPlanLimitMock = vi.fn()
const checkPlanFeatureMock = vi.fn()
const inviteUserMock = vi.fn()
const requireWriteMock = vi.fn()

vi.mock('@/lib/plans', () => ({
  checkPlanLimit: (...a: unknown[]) => checkPlanLimitMock(...a),
  checkPlanFeature: (...a: unknown[]) => checkPlanFeatureMock(...a),
}))
vi.mock('@/lib/write-access', () => ({
  requireWrite: (...a: unknown[]) => requireWriteMock(...a),
}))
vi.mock('@/db/queries/users', () => ({
  inviteUser: (...a: unknown[]) => inviteUserMock(...a),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))

import { POST as invite } from '@/app/api/tenant/users/invite/route'

const CTX = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

function inviteRequest() {
  return new Request('http://localhost/api/tenant/users/invite', {
    method: 'POST',
    body: JSON.stringify({ email: 'nova@clinica.com', fullName: 'Nova', role: 'receptionist' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireWriteMock.mockResolvedValue({ ctx: CTX, blocked: null })
  inviteUserMock.mockResolvedValue({ success: true })
  checkPlanLimitMock.mockResolvedValue({ allowed: true, used: 1, limit: 2 })
})

describe('seat limit on invite', () => {
  it('refuses a new seat once the plan limit is reached', async () => {
    checkPlanLimitMock.mockResolvedValue({ allowed: false, used: 2, limit: 2 })

    const res = await invite(inviteRequest())
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body.used).toBe(2)
    expect(body.limit).toBe(2)
    // The seat must not be consumed by a request that was refused.
    expect(inviteUserMock).not.toHaveBeenCalled()
  })

  it('allows the invite while there is room', async () => {
    const res = await invite(inviteRequest())

    expect(res.status).toBe(200)
    expect(inviteUserMock).toHaveBeenCalled()
  })

  it('checks the limit for the caller tenant', async () => {
    await invite(inviteRequest())
    expect(checkPlanLimitMock).toHaveBeenCalledWith('tenant-1', 'users')
  })

  it('reports the real usage when a tenant is already over its limit', async () => {
    // Enforcement is on the way in only, so a tenant that is already over
    // keeps its members. What the route must not do is clamp the numbers it
    // reports: the owner needs to see 5 of 2 to understand why.
    checkPlanLimitMock.mockResolvedValue({ allowed: false, used: 5, limit: 2 })

    const res = await invite(inviteRequest())
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body.used).toBe(5)
    expect(body.limit).toBe(2)
    expect(inviteUserMock).not.toHaveBeenCalled()
  })
})

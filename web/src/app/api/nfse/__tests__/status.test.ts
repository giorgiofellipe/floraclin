import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

const auth = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new ForbiddenError()
    return { tenantId: 'tenant-1', userId: 'user-1', role: auth.role }
  }),
}))
vi.mock('@/db/queries/nfse', () => ({ getNfseSettings: vi.fn(async () => ({ configured: true })) }))

import { GET } from '../status/route'

describe('GET /api/nfse/status', () => {
  it.each([
    ['owner', true],
    ['financial', true],
    ['receptionist', false],
  ])('lets %s cancel notes: %s', async (role, canCancel) => {
    auth.role = role
    const res = await GET(new Request('http://localhost/api/nfse/status'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { configured: true, canEmit: true, canCancel } })
  })

  it('refuses a practitioner, who has no access to payments', async () => {
    auth.role = 'practitioner'
    const res = await GET(new Request('http://localhost/api/nfse/status'))
    expect(res.status).toBe(403)
  })
})

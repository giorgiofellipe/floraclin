import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/db/queries/admin-users', () => ({ removeUserMembership: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({ revokeMemberCalendarAccess: vi.fn() }))

import { removeUserMembership } from '@/db/queries/admin-users'
import { revokeMemberCalendarAccess } from '@/lib/google-calendar'
import { DELETE } from '../route'

beforeEach(() => {
  vi.mocked(removeUserMembership).mockReset().mockResolvedValue({ role: 'practitioner' } as never)
  vi.mocked(revokeMemberCalendarAccess).mockReset()
})

describe('DELETE /api/admin/users/[id]/memberships/[tenantId]', () => {
  it("revokes the member's calendar access in that clinic", async () => {
    const res = await DELETE(new Request('http://localhost/api/admin/users/u1/memberships/t1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'u1', tenantId: 't1' }),
    })

    expect(res.status).toBe(200)
    expect(revokeMemberCalendarAccess).toHaveBeenCalledWith('t1', 'u1', 'practitioner')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'owner-1' }, blocked: null })),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/users', () => ({ deactivateUser: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({ revokeMemberCalendarAccess: vi.fn() }))

import { deactivateUser } from '@/db/queries/users'
import { revokeMemberCalendarAccess } from '@/lib/google-calendar'
import { PUT } from '../route'

function deactivate(userId: string) {
  return PUT(new Request(`http://localhost/api/tenant/users/${userId}/deactivate`, { method: 'PUT' }), {
    params: Promise.resolve({ id: userId }),
  })
}

beforeEach(() => {
  vi.mocked(deactivateUser).mockReset().mockResolvedValue({ role: 'owner' })
  vi.mocked(revokeMemberCalendarAccess).mockReset()
})

describe('PUT /api/tenant/users/[id]/deactivate', () => {
  it("revokes the member's calendar access with their role", async () => {
    const res = await deactivate('member-1')

    expect(res.status).toBe(200)
    expect(revokeMemberCalendarAccess).toHaveBeenCalledWith('tenant-1', 'member-1', 'owner')
  })
})

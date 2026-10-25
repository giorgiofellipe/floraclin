import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The iCal feed and Google push are keyed to the calendar connection, not the
 * membership. Unless deactivation removes it, the member keeps a live feed of
 * their appointments with patient names after losing access to the app.
 */

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'owner-1' }, blocked: null })),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/users', () => ({ deactivateUser: vi.fn() }))
vi.mock('@/db/queries/calendar', () => ({ getConnectionByUserId: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({ disconnectCalendar: vi.fn() }))

import { deactivateUser } from '@/db/queries/users'
import { getConnectionByUserId } from '@/db/queries/calendar'
import { disconnectCalendar } from '@/lib/google-calendar'
import { PUT } from '../route'

function deactivate(userId: string) {
  return PUT(new Request(`http://localhost/api/tenant/users/${userId}/deactivate`, { method: 'PUT' }), {
    params: Promise.resolve({ id: userId }),
  })
}

beforeEach(() => {
  vi.mocked(deactivateUser).mockReset().mockResolvedValue(true)
  vi.mocked(getConnectionByUserId).mockReset().mockResolvedValue(null)
  vi.mocked(disconnectCalendar).mockReset()
})

describe('PUT /api/tenant/users/[id]/deactivate', () => {
  it("disconnects the member's calendar", async () => {
    const connection = { id: 'conn-1', tenantId: 'tenant-1', userId: 'member-1' }
    vi.mocked(getConnectionByUserId).mockResolvedValue(connection as never)

    const res = await deactivate('member-1')

    expect(res.status).toBe(200)
    expect(getConnectionByUserId).toHaveBeenCalledWith('tenant-1', 'member-1')
    expect(disconnectCalendar).toHaveBeenCalledWith(connection)
  })

})

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A removed member must lose every calendar feed they could read: their own
 * connection, and for an owner also the clinic-wide feed URL.
 */

vi.mock('googleapis', () => ({ google: { auth: { OAuth2: function () { return { revokeToken: vi.fn() } } } } }))
vi.mock('@/db/queries/calendar', () => ({
  getConnectionById: vi.fn(),
  getConnectionByUserId: vi.fn(),
  getClinicConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  deleteBlocksByConnection: vi.fn(),
  clearAppointmentGoogleEventIds: vi.fn(),
}))

import {
  getConnectionByUserId,
  getClinicConnection,
  updateConnection,
  deleteConnection,
} from '@/db/queries/calendar'
import { revokeMemberCalendarAccess } from '../google-calendar'

const memberConnection = { id: 'conn-member', tenantId: 'tenant-1', userId: 'member-1', channelId: null, channelResourceId: null }
const clinicConnection = { id: 'conn-clinic', tenantId: 'tenant-1', userId: null, feedToken: 'old-feed' }

beforeEach(() => {
  vi.mocked(getConnectionByUserId).mockReset().mockResolvedValue(memberConnection as never)
  vi.mocked(getClinicConnection).mockReset().mockResolvedValue(clinicConnection as never)
  vi.mocked(updateConnection).mockReset()
  vi.mocked(deleteConnection).mockReset().mockResolvedValue(null as never)
})

describe('revokeMemberCalendarAccess', () => {
  it("deletes the member's own connection", async () => {
    await revokeMemberCalendarAccess('tenant-1', 'member-1', 'practitioner')

    expect(getConnectionByUserId).toHaveBeenCalledWith('tenant-1', 'member-1')
    expect(deleteConnection).toHaveBeenCalledWith('conn-member', 'tenant-1')
  })

  it('rotates the clinic feed token when the member was an owner', async () => {
    await revokeMemberCalendarAccess('tenant-1', 'owner-2', 'owner')

    expect(updateConnection).toHaveBeenCalledWith('conn-clinic', 'tenant-1', {
      feedToken: expect.not.stringMatching(/^old-feed$/),
    })
  })

  it('keeps the clinic feed token for a non-owner', async () => {
    await revokeMemberCalendarAccess('tenant-1', 'member-1', 'receptionist')

    expect(updateConnection).not.toHaveBeenCalled()
  })
})

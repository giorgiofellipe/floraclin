import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/google-calendar-sync', () => ({ syncAppointmentToGoogle: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({ reportCalendarFailure: vi.fn() }))
vi.mock('@/db/queries/appointments', () => ({ getAppointmentById: vi.fn(), updateAppointmentStatus: vi.fn() }))

import { requireWrite } from '@/lib/write-access'
import { getAppointmentById, updateAppointmentStatus } from '@/db/queries/appointments'
import { PUT } from '../route'

const ID = '11111111-1111-4111-8111-111111111111'

function put(body: Record<string, unknown>) {
  return PUT(
    new Request(`http://localhost/api/appointments/${ID}/status`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ID }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: { tenantId: 't1', userId: 'u1' }, blocked: null } as never)
  vi.mocked(updateAppointmentStatus).mockResolvedValue({ id: ID } as never)
})

describe('PUT /api/appointments/[id]/status undo', () => {
  it('refuses an undo when someone changed the appointment after the status being undone', async () => {
    // Regression: "Desfazer" on an old toast wrote "scheduled" over a colleague's "in_progress".
    vi.mocked(getAppointmentById).mockResolvedValue({ id: ID, updatedAt: new Date('2026-11-16T12:05:00.000Z') } as never)

    const res = await put({ status: 'scheduled', expectedUpdatedAt: '2026-11-16T12:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(updateAppointmentStatus).not.toHaveBeenCalled()
  })

  it('applies the undo when nothing changed since', async () => {
    vi.mocked(getAppointmentById).mockResolvedValue({ id: ID, updatedAt: new Date('2026-11-16T12:00:00.000Z') } as never)

    const res = await put({ status: 'scheduled', expectedUpdatedAt: '2026-11-16T12:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(updateAppointmentStatus).toHaveBeenCalledWith('t1', ID, 'scheduled')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/google-calendar-sync', () => ({
  syncAppointmentToGoogle: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/google-calendar', () => ({
  reportCalendarFailure: vi.fn(),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentById: vi.fn(),
  updateAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  checkTimeConflict: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { getAppointmentById, updateAppointment, checkTimeConflict } from '@/db/queries/appointments'
import { PUT } from '../route'

const APPOINTMENT_ID = '11111111-1111-4111-8111-111111111111'
const PRACTITIONER_ID = '22222222-2222-4222-8222-222222222222'

const current = {
  id: APPOINTMENT_ID,
  practitionerId: PRACTITIONER_ID,
  date: '2026-10-12',
  startTime: '09:00:00',
  endTime: '09:30:00',
}

function put(body: Record<string, unknown>) {
  return PUT(
    new Request(`http://localhost/api/appointments/${APPOINTMENT_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: APPOINTMENT_ID }) },
  )
}

// The agenda form resends the whole slot on every save, with HH:MM times.
const sameSlot = { practitionerId: PRACTITIONER_ID, date: '2026-10-12', startTime: '09:00', endTime: '09:30' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(getAppointmentById).mockResolvedValue(current as never)
  vi.mocked(updateAppointment).mockResolvedValue({ ...current, notes: 'x' } as never)
  vi.mocked(checkTimeConflict).mockResolvedValue(true)
})

describe('PUT /api/appointments/[id]', () => {
  it('skips the conflict check when the slot and practitioner are unchanged', async () => {
    // Regression: after a block was placed over an existing appointment, a notes-only edit answered 409.
    const res = await put({ ...sameSlot, notes: 'chegou atrasada' })

    expect(res.status).toBe(200)
    expect(checkTimeConflict).not.toHaveBeenCalled()
    expect(updateAppointment).toHaveBeenCalled()
  })

  it('refuses a partial update that leaves the appointment with zero duration', async () => {
    // Regression: '09:30' >= '09:30:00' is false as strings, so a start-only edit matching the stored end slipped past the range guard.
    vi.mocked(checkTimeConflict).mockResolvedValue(false)

    const res = await put({ startTime: '09:30' })

    expect(res.status).toBe(400)
    expect(updateAppointment).not.toHaveBeenCalled()
  })

  it('refuses a moved slot that conflicts, without naming an appointment as the cause', async () => {
    const res = await put({ ...sameSlot, startTime: '10:00', endTime: '10:30' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Horário indisponível para este profissional.' })
    expect(checkTimeConflict).toHaveBeenCalledWith('tenant-1', PRACTITIONER_ID, '2026-10-12', '10:00', '10:30', APPOINTMENT_ID)
    expect(updateAppointment).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/appointments', () => ({ getAppointmentById: vi.fn() }))
vi.mock('@/lib/whatsapp-reschedule', () => ({ sendRescheduleNotification: vi.fn() }))
vi.mock('@/lib/dates', async (importOriginal) => ({ ...(await importOriginal<object>()), brToday: () => '2026-11-14' }))

import { requireWrite } from '@/lib/write-access'
import { getAppointmentById } from '@/db/queries/appointments'
import { sendRescheduleNotification } from '@/lib/whatsapp-reschedule'
import { POST } from '../route'

const ctx = { tenantId: 't1', userId: 'u1', role: 'receptionist' }

function post() {
  return POST(new Request('http://localhost/api/appointments/a1/reschedule-notice', { method: 'POST' }), { params: Promise.resolve({ id: 'a1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx, blocked: null } as never)
  vi.mocked(sendRescheduleNotification).mockResolvedValue('sent')
})

describe('POST /api/appointments/[id]/reschedule-notice', () => {
  it('sends the notice for an upcoming appointment the patient still has to attend', async () => {
    const appointment = { id: 'a1', status: 'scheduled', date: '2026-11-18', startTime: '10:00:00' }
    vi.mocked(getAppointmentById).mockResolvedValue(appointment as never)

    const res = await post()

    expect(await res.json()).toEqual({ success: true, notification: 'sent' })
    expect(sendRescheduleNotification).toHaveBeenCalledWith('t1', 'u1', appointment)
  })

  // The drag toast offers the notice after the move; by the time it is tapped the appointment may be
  // in the past or already attended, and the patient must not get a message about it.
  it.each([
    ['a past date', { status: 'scheduled', date: '2026-11-13' }],
    ['a completed appointment', { status: 'completed', date: '2026-11-18' }],
  ])('refuses %s', async (_label, fields) => {
    vi.mocked(getAppointmentById).mockResolvedValue({ id: 'a1', startTime: '10:00:00', ...fields } as never)

    const res = await post()

    expect(res.status).toBe(400)
    expect(sendRescheduleNotification).not.toHaveBeenCalled()
  })
})

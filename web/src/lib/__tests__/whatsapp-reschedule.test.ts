// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock, reportMock } = vi.hoisted(() => ({ sendMock: vi.fn(), reportMock: vi.fn() }))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: async () => ({ id: 't1', name: 'Clínica Flora', settings: { whatsapp_enabled: true } }),
}))
vi.mock('@/db/queries/patients', () => ({ getPatient: async () => null }))
vi.mock('@/lib/whatsapp', () => ({
  getTemplateForTenant: async () => ({ name: 'reschedule_notification', status: 'APPROVED', components: [] }),
}))
vi.mock('@/lib/whatsapp-automated-send', () => ({ sendAndRecordTemplate: sendMock }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: reportMock }))

import { sendRescheduleNotification } from '../whatsapp-reschedule'
import { EmailConfirmationRequiredError } from '../email-confirmation-gate'
import { SubscriptionExpiredError } from '../plans'

const appointment = {
  id: 'a1',
  patientId: null,
  patientName: null,
  bookingName: 'Maria',
  bookingPhone: '11999991234',
  date: '2026-11-10',
  startTime: '14:00:00',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendRescheduleNotification', () => {
  // Catches a clinic that cannot send yet being reported to Sentry as a failure.
  it.each([
    ['the subscription expired', new SubscriptionExpiredError()],
    ['the owner has not confirmed the address', new EmailConfirmationRequiredError()],
  ])('is unavailable, not failed, when %s', async (_name, error) => {
    sendMock.mockRejectedValue(error)

    expect(await sendRescheduleNotification('t1', 'u1', appointment)).toBe('unavailable')
    expect(reportMock).not.toHaveBeenCalled()
  })
})

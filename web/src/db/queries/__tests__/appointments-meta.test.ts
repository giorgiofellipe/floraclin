import { describe, it, expect, vi, beforeEach } from 'vitest'

// A minimal thenable chain: every builder method used by `createAppointment`
// returns the same chain instance, and the chain resolves to `result`
// however long the call chain is.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const passthrough = ['values', 'returning']
  for (const method of passthrough) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    insert: insertMock,
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {},
  patients: {},
  procedureTypes: {},
  users: {},
  tenants: {},
  calendarBlocks: {},
}))

const { verifyTenantOwnershipMock, verifyUserBelongsToTenantMock } = vi.hoisted(() => ({
  verifyTenantOwnershipMock: vi.fn(async () => {}),
  verifyUserBelongsToTenantMock: vi.fn(async () => {}),
}))

vi.mock('../helpers', () => ({
  verifyTenantOwnership: verifyTenantOwnershipMock,
  verifyUserBelongsToTenant: verifyUserBelongsToTenantMock,
}))

const { resolveProspectForPatientMock } = vi.hoisted(() => ({
  resolveProspectForPatientMock: vi.fn(),
}))

vi.mock('@/lib/meta/resolve-prospect', () => ({
  resolveProspectForPatient: resolveProspectForPatientMock,
}))

const { hasScheduleForProspectMock } = vi.hoisted(() => ({
  hasScheduleForProspectMock: vi.fn(),
}))

vi.mock('../meta-events', () => ({
  hasScheduleForProspect: hasScheduleForProspectMock,
}))

const { enqueueMetaEventMock } = vi.hoisted(() => ({
  enqueueMetaEventMock: vi.fn(),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: enqueueMetaEventMock,
}))

const { getPatientMock } = vi.hoisted(() => ({
  getPatientMock: vi.fn(),
}))

vi.mock('../patients', () => ({
  getPatient: getPatientMock,
}))

const { reportSideEffectFailureMock } = vi.hoisted(() => ({
  reportSideEffectFailureMock: vi.fn(),
}))

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: reportSideEffectFailureMock,
}))

import { createAppointment } from '../appointments'

const TENANT = 'tenant-1'
const PROSPECT = 'prospect-1'

function baseAppointmentData(overrides: Record<string, unknown> = {}) {
  return {
    practitionerId: 'practitioner-1',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '10:30',
    ...overrides,
  }
}

function mockInsertedAppointment(row: Record<string, unknown>) {
  insertMock.mockReturnValue(makeChain([row]))
}

describe('createAppointment: Meta Schedule event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasScheduleForProspectMock.mockResolvedValue(false)
    getPatientMock.mockResolvedValue(null)
  })

  it('emits one Schedule for a matched prospect', async () => {
    mockInsertedAppointment({ id: 'appt-1', source: 'internal' })
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })

    await createAppointment(
      TENANT,
      baseAppointmentData({ bookingPhone: '5511999999999', bookingName: 'Jane Doe' })
    )

    expect(resolveProspectForPatientMock).toHaveBeenCalledWith(TENANT, {
      patientId: undefined,
      phone: '5511999999999',
    })
    expect(hasScheduleForProspectMock).toHaveBeenCalledWith(TENANT, PROSPECT)
    expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        eventName: 'Schedule',
        eventId: 'schedule:appt-1',
        prospectId: PROSPECT,
        patientId: null,
        contact: { phone: '5511999999999', email: null, fullName: 'Jane Doe' },
        actionSource: 'system_generated',
      })
    )
  })

  it('emits nothing for a patient with no matching prospect', async () => {
    mockInsertedAppointment({ id: 'appt-2', source: 'internal' })
    resolveProspectForPatientMock.mockResolvedValue(null)

    await createAppointment(TENANT, baseAppointmentData({ patientId: 'patient-1' }))

    expect(hasScheduleForProspectMock).not.toHaveBeenCalled()
    expect(enqueueMetaEventMock).not.toHaveBeenCalled()
  })

  it('emits nothing when the card was already dragged to agendado', async () => {
    mockInsertedAppointment({ id: 'appt-3', source: 'internal' })
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })
    hasScheduleForProspectMock.mockResolvedValue(true)

    await createAppointment(TENANT, baseAppointmentData({ bookingPhone: '5511999999999' }))

    expect(enqueueMetaEventMock).not.toHaveBeenCalled()
  })

  it('emits nothing for a second appointment for the same prospect', async () => {
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })

    mockInsertedAppointment({ id: 'appt-4', source: 'internal' })
    hasScheduleForProspectMock.mockResolvedValueOnce(false)
    await createAppointment(TENANT, baseAppointmentData({ bookingPhone: '5511999999999' }))

    mockInsertedAppointment({ id: 'appt-5', source: 'internal' })
    hasScheduleForProspectMock.mockResolvedValueOnce(true)
    await createAppointment(TENANT, baseAppointmentData({ bookingPhone: '5511999999999' }))

    expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
  })

  it('still emits for a prospect found only by the patient phone, with no convertedPatientId', async () => {
    mockInsertedAppointment({ id: 'appt-6', source: 'internal' })
    // resolveProspectForPatient is the single lookup point; from this call
    // site's perspective a match via convertedPatientId and a match via the
    // patient's own phone look identical, which is exactly what makes it
    // safe to hook createAppointment once.
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })

    await createAppointment(TENANT, baseAppointmentData({ patientId: 'patient-1' }))

    expect(resolveProspectForPatientMock).toHaveBeenCalledWith(TENANT, {
      patientId: 'patient-1',
      phone: undefined,
    })
    expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
  })

  it('uses website as the action source for an online booking', async () => {
    mockInsertedAppointment({ id: 'appt-7', source: 'online_booking' })
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })

    await createAppointment(
      TENANT,
      baseAppointmentData({ bookingPhone: '5511999999999', source: 'online_booking' as const })
    )

    expect(enqueueMetaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionSource: 'website' })
    )
  })

  it('a staff-created appointment carries the patient phone, email and name', async () => {
    mockInsertedAppointment({ id: 'appt-9', source: 'internal' })
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })
    getPatientMock.mockResolvedValue({
      id: 'patient-1',
      phone: '5511988887777',
      email: 'maria@example.com',
      fullName: 'Maria Souza',
    })

    await createAppointment(TENANT, baseAppointmentData({ patientId: 'patient-1' }))

    expect(getPatientMock).toHaveBeenCalledWith(TENANT, 'patient-1')
    expect(enqueueMetaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Schedule',
        patientId: 'patient-1',
        contact: {
          phone: '5511988887777',
          email: 'maria@example.com',
          fullName: 'Maria Souza',
        },
      })
    )
  })

  it('prefers the patient record over the booking fields when both are present', async () => {
    mockInsertedAppointment({ id: 'appt-10', source: 'online_booking' })
    resolveProspectForPatientMock.mockResolvedValue({ id: PROSPECT })
    getPatientMock.mockResolvedValue({
      id: 'patient-1',
      phone: '5511988887777',
      email: null,
      fullName: 'Maria Souza',
    })

    await createAppointment(
      TENANT,
      baseAppointmentData({
        patientId: 'patient-1',
        bookingPhone: '5511999999999',
        bookingName: 'Jane Doe',
        bookingEmail: 'jane@example.com',
      })
    )

    expect(enqueueMetaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: {
          phone: '5511988887777',
          email: 'jane@example.com',
          fullName: 'Maria Souza',
        },
      })
    )
  })

  it('never throws when the prospect lookup fails', async () => {
    mockInsertedAppointment({ id: 'appt-8', source: 'internal' })
    resolveProspectForPatientMock.mockRejectedValue(new Error('db unavailable'))

    const result = await createAppointment(
      TENANT,
      baseAppointmentData({ bookingPhone: '5511999999999' })
    )

    expect(result).toEqual({ id: 'appt-8', source: 'internal' })
    expect(enqueueMetaEventMock).not.toHaveBeenCalled()
    expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
  })
})

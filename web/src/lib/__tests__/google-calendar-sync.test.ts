import { describe, it, expect, vi } from 'vitest'

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    calendar: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getGoogleCalendarClient: vi.fn().mockResolvedValue({
    calendar: {
      events: {
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      },
    },
    connection: { calendarId: 'primary' },
  }),
}))

vi.mock('@/db/queries/calendar', () => ({
  getConnectionByUserId: vi.fn().mockResolvedValue(null),
  getClinicConnection: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: { id: 'id', tenantId: 'tenant_id', patientId: 'patient_id', practitionerId: 'practitioner_id', procedureTypeId: 'procedure_type_id', date: 'date', startTime: 'start_time', endTime: 'end_time', status: 'status', googleEventId: 'google_event_id', clinicGoogleEventId: 'clinic_google_event_id', deletedAt: 'deleted_at' },
  patients: { id: 'id', fullName: 'full_name' },
  procedureTypes: { id: 'id', name: 'name' },
}))

import { buildEventSummary, buildEventBody } from '../google-calendar-sync'

describe('buildEventSummary', () => {
  it('should combine procedure type and patient name', () => {
    expect(buildEventSummary('Maria Silva', 'Botox')).toBe('Botox - Maria Silva')
  })

  it('should use patient name only when no procedure type', () => {
    expect(buildEventSummary('Maria Silva', null)).toBe('Maria Silva')
  })

  it('should use default when no patient or procedure', () => {
    expect(buildEventSummary(null, null)).toBe('Agendamento')
  })
})

describe('buildEventBody', () => {
  const baseAppt = {
    id: 'appt-1',
    tenantId: 'tenant-1',
    practitionerId: 'user-1',
    date: '2026-05-28',
    startTime: '14:00',
    endTime: '15:00',
    status: 'confirmed',
    googleEventId: null,
    clinicGoogleEventId: null,
    patientName: 'Maria Silva',
    procedureTypeName: 'Botox',
    deletedAt: null,
  }

  it('should build a confirmed event body', () => {
    const body = buildEventBody(baseAppt)
    expect(body.summary).toBe('Botox - Maria Silva')
    expect(body.description).toBe('Agendamento FloraClin')
    expect(body.start.dateTime).toBe('2026-05-28T14:00:00')
    expect(body.start.timeZone).toBe('America/Sao_Paulo')
    expect(body.end.dateTime).toBe('2026-05-28T15:00:00')
    expect(body.status).toBe('confirmed')
  })

  it('should build a tentative event for scheduled status', () => {
    const body = buildEventBody({ ...baseAppt, status: 'scheduled' })
    expect(body.status).toBe('tentative')
  })

  it('should map in_progress to confirmed', () => {
    const body = buildEventBody({ ...baseAppt, status: 'in_progress' })
    expect(body.status).toBe('confirmed')
  })

  it('should map completed to confirmed', () => {
    const body = buildEventBody({ ...baseAppt, status: 'completed' })
    expect(body.status).toBe('confirmed')
  })
})

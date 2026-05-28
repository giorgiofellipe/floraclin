import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockLeftJoin = vi.fn()
const mockWhere = vi.fn()
const mockOrderBy = vi.fn()

vi.mock('@/db/client', () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args)
      return {
        from: (...a: unknown[]) => {
          mockFrom(...a)
          return {
            leftJoin: (...a2: unknown[]) => {
              mockLeftJoin(...a2)
              return {
                leftJoin: (...a3: unknown[]) => {
                  mockLeftJoin(...a3)
                  return {
                    where: (...a4: unknown[]) => {
                      mockWhere(...a4)
                      return {
                        orderBy: (...a5: unknown[]) => {
                          mockOrderBy(...a5)
                          return []
                        },
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    id: 'id',
    tenantId: 'tenant_id',
    practitionerId: 'practitioner_id',
    patientId: 'patient_id',
    procedureTypeId: 'procedure_type_id',
    date: 'date',
    startTime: 'start_time',
    endTime: 'end_time',
    status: 'status',
    deletedAt: 'deleted_at',
  },
  patients: { id: 'id', fullName: 'full_name' },
  procedureTypes: { id: 'id', name: 'name' },
}))

vi.mock('@/lib/dates', () => ({
  toBrYmd: vi.fn((date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }),
  parseBrDate: vi.fn((ymd: string, time: string) => new Date(`${ymd}T${time}`)),
}))

import { generateICalFeed } from '../ical-feed'

describe('generateICalFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate valid iCal output with no events', async () => {
    const result = await generateICalFeed('tenant-1', 'user-1', 'Test Calendar')
    expect(result).toContain('BEGIN:VCALENDAR')
    expect(result).toContain('END:VCALENDAR')
    expect(result).toContain('Test Calendar')
  })

  it('should generate valid iCal for clinic feed (null userId)', async () => {
    const result = await generateICalFeed('tenant-1', null, 'FloraClin - Clínica')
    expect(result).toContain('BEGIN:VCALENDAR')
    expect(result).toContain('FloraClin')
  })
})

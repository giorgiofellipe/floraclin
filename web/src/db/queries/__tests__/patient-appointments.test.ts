import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { chainCapturing, type Capture } from '@/tests/mocks/drizzle-tx'

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: selectMock } }))

import { listPatientAppointments } from '../appointments'

beforeEach(() => selectMock.mockReset())

describe('listPatientAppointments', () => {
  it('scopes the query to the tenant and the patient and skips soft-deleted rows', async () => {
    // Regression: dropping either id filter would leak another tenant's or patient's agenda.
    const capture: Capture = {}
    selectMock.mockReturnValueOnce(chainCapturing([{ id: 'a1' }], capture))

    const rows = await listPatientAppointments('tenant-1', 'patient-1')

    const { sql, params } = new PgDialect().sqlToQuery(capture.where as SQL)
    expect(rows).toEqual([{ id: 'a1' }])
    expect(params).toEqual(['tenant-1', 'patient-1'])
    expect(sql).toContain('"deleted_at" is null')
  })
})

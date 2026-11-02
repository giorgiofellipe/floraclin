import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/db/queries/appointments', () => ({ listPatientAppointments: vi.fn() }))
vi.mock('@/db/queries/financial', () => ({ getPatientFinancialSummary: vi.fn() }))

import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { listPatientAppointments } from '@/db/queries/appointments'
import { getPatientFinancialSummary } from '@/db/queries/financial'
import { GET as getAppointments } from '../[id]/appointments/route'
import { GET as getFinancialSummary } from '../[id]/financial-summary/route'

const params = { params: Promise.resolve({ id: 'p1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role: 'owner' } as never)
})

describe.each([
  ['appointments', getAppointments, listPatientAppointments],
  ['financial-summary', getFinancialSummary, getPatientFinancialSummary],
])('GET /api/patients/[id]/%s', (_name, GET, loader) => {
  it('returns 404 and loads nothing when the patient is not in the caller tenant', async () => {
    vi.mocked(getPatient).mockResolvedValue(null as never)

    const res = await GET(new Request('http://test'), params)

    expect(res.status).toBe(404)
    expect(getPatient).toHaveBeenCalledWith('tenant-1', 'p1')
    expect(loader).not.toHaveBeenCalled()
  })

  it('returns the data for a patient of the caller tenant', async () => {
    vi.mocked(getPatient).mockResolvedValue({ id: 'p1' } as never)
    ;(loader as ReturnType<typeof vi.fn>).mockResolvedValue([{ x: 1 }])

    const res = await GET(new Request('http://test'), params)

    expect(await res.json()).toEqual({ data: [{ x: 1 }] })
    expect(loader).toHaveBeenCalledWith('tenant-1', 'p1')
  })
})

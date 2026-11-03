import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/consent', () => ({ listPendingConsents: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))

import { getAuthContext } from '@/lib/auth'
import { listPendingConsents } from '@/db/queries/consent'
import { getPatient } from '@/db/queries/patients'
import { GET } from '../[patientId]/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role: 'owner' } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: 'p1' } as never)
})

describe('GET /api/consent/pending/[patientId]', () => {
  it('lists pending consents scoped to the caller tenant, not one from the request', async () => {
    const rows = [{ id: 'c1' }]
    vi.mocked(listPendingConsents).mockResolvedValue(rows as never)

    const res = await GET(new Request('http://test'), { params: Promise.resolve({ patientId: 'p1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: rows })
    expect(listPendingConsents).toHaveBeenCalledWith('tenant-1', 'p1')
  })

  it('returns 404 without listing for a deleted or foreign patient', async () => {
    vi.mocked(getPatient).mockResolvedValue(null)

    const res = await GET(new Request('http://test'), { params: Promise.resolve({ patientId: 'p1' }) })

    expect(res.status).toBe(404)
    expect(getPatient).toHaveBeenCalledWith('tenant-1', 'p1')
    expect(listPendingConsents).not.toHaveBeenCalled()
  })
})

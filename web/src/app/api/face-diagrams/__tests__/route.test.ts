import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/face-diagrams', () => ({ getPreviousDiagramPoints: vi.fn() }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))

import { getAuthContext } from '@/lib/auth'
import { getPreviousDiagramPoints } from '@/db/queries/face-diagrams'
import { getPatient } from '@/db/queries/patients'
import { GET } from '../route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role: 'owner' } as never)
})

describe('GET /api/face-diagrams', () => {
  it('returns 404 without reading points for a deleted or foreign patient', async () => {
    vi.mocked(getPatient).mockResolvedValue(null)

    const res = await GET(new Request('http://test/api/face-diagrams?patientId=p1'))

    expect(res.status).toBe(404)
    expect(getPatient).toHaveBeenCalledWith('tenant-1', 'p1')
    expect(getPreviousDiagramPoints).not.toHaveBeenCalled()
  })
})

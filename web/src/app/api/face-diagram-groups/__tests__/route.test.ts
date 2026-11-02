import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => {
  const { ForbiddenError } = await import('@/lib/errors')
  const getAuthContext = vi.fn()
  return {
    getAuthContext,
    requireRole: async (...roles: string[]) => {
      const ctx = await getAuthContext()
      if (!roles.includes(ctx.role)) throw new ForbiddenError('Forbidden')
      return ctx
    },
  }
})
vi.mock('@/lib/plans', () => ({ subscriptionGate: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
}))
vi.mock('@/db/queries/helpers', () => ({ verifyTenantOwnership: vi.fn() }))
vi.mock('@/db/queries/face-diagram-groups', async () => {
  class DiagramGroupLockedError extends Error {}
  return {
    DiagramGroupLockedError,
    createStandaloneGroup: vi.fn(),
    updateStandaloneGroup: vi.fn(),
    getDiagramGroup: vi.fn(),
    listPatientDiagramGroups: vi.fn(),
  }
})

import { getAuthContext } from '@/lib/auth'
import {
  DiagramGroupLockedError,
  createStandaloneGroup,
  getDiagramGroup,
  updateStandaloneGroup,
} from '@/db/queries/face-diagram-groups'
import { POST } from '@/app/api/patients/[id]/face-diagram-groups/route'
import { GET, PUT } from '../[id]/route'

const validBody = { views: [{ viewType: 'front', points: [] }], quotationLines: [] }
const json = (body: unknown) =>
  new Request('http://test', { method: 'POST', body: JSON.stringify(body) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function as(role: string) {
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  as('owner')
})

describe('diagram group routes', () => {
  it('rejects create from a receptionist with 403', async () => {
    as('receptionist')
    const res = await POST(json(validBody), params('p1'))
    expect(res.status).toBe(403)
    expect(createStandaloneGroup).not.toHaveBeenCalled()
  })

  it('rejects create with no views with 400', async () => {
    const res = await POST(json({ views: [], quotationLines: [] }), params('p1'))
    expect(res.status).toBe(400)
    expect(createStandaloneGroup).not.toHaveBeenCalled()
  })

  it('creates the group with the caller as practitioner', async () => {
    vi.mocked(createStandaloneGroup).mockResolvedValue('g1')
    const res = await POST(json(validBody), params('p1'))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { id: 'g1' } })
    expect(createStandaloneGroup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', patientId: 'p1', practitionerId: 'user-1' })
    )
  })

  it('maps a locked group on update to 409 with the lock message', async () => {
    vi.mocked(updateStandaloneGroup).mockRejectedValue(new DiagramGroupLockedError('x'))
    const res = await PUT(json(validBody), params('g1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Este diagrama está vinculado a um atendimento e não pode ser editado',
    })
  })

  it('returns 404 for a group outside the tenant', async () => {
    vi.mocked(getDiagramGroup).mockResolvedValue(null)
    const res = await GET(new Request('http://test'), params('other'))
    expect(res.status).toBe(404)
    expect(getDiagramGroup).toHaveBeenCalledWith('tenant-1', 'other')
  })
})

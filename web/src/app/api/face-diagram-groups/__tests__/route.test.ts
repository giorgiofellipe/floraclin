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
const tx = vi.hoisted(() => ({ name: 'tx' }))
vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
}))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/queries/face-diagram-groups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/face-diagram-groups')>()
  return {
    DiagramGroupLockedError: actual.DiagramGroupLockedError,
    DiagramGroupNotFoundError: actual.DiagramGroupNotFoundError,
    InvalidQuotationLineError: actual.InvalidQuotationLineError,
    createStandaloneGroup: vi.fn(),
    updateStandaloneGroup: vi.fn(),
    getDiagramGroup: vi.fn(),
    listPatientDiagramGroups: vi.fn(),
  }
})

import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { createAuditLog } from '@/lib/audit'
import {
  DiagramGroupLockedError,
  DiagramGroupNotFoundError,
  InvalidQuotationLineError,
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
  vi.mocked(getPatient).mockResolvedValue({ id: 'p1' } as never)
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
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'g1' }), tx)
  })

  it('returns 404 on create for a patient outside the tenant', async () => {
    vi.mocked(getPatient).mockResolvedValue(null)
    const res = await POST(json(validBody), params('p1'))
    expect(res.status).toBe(404)
    expect(createStandaloneGroup).not.toHaveBeenCalled()
  })

  it('surfaces a failed patient lookup as an error, not as a missing patient', async () => {
    vi.mocked(getPatient).mockRejectedValue(new Error('connection reset'))
    const res = await POST(json(validBody), params('p1'))
    expect(res.status).toBe(500)
    expect(createStandaloneGroup).not.toHaveBeenCalled()
  })

  it('rejects create with a procedure outside the tenant catalog with 400', async () => {
    vi.mocked(createStandaloneGroup).mockRejectedValue(new InvalidQuotationLineError())
    const res = await POST(json(validBody), params('p1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Procedimento inválido no orçamento' })
  })

  it.each([
    [new DiagramGroupNotFoundError(), 404, 'Diagrama não encontrado'],
    [new DiagramGroupLockedError('Este diagrama não pode mais ser editado'), 409, 'Este diagrama não pode mais ser editado'],
    [new InvalidQuotationLineError(), 400, 'Procedimento inválido no orçamento'],
  ])('maps %s on update to its status and message', async (error, status, message) => {
    vi.mocked(updateStandaloneGroup).mockRejectedValue(error)
    const res = await PUT(json(validBody), params('g1'))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: message })
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('audits the update inside the transaction', async () => {
    vi.mocked(updateStandaloneGroup).mockResolvedValue()
    const res = await PUT(json(validBody), params('g1'))
    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'g1' }), tx)
  })

  it('returns 404 for a group outside the tenant', async () => {
    vi.mocked(getDiagramGroup).mockResolvedValue(null)
    const res = await GET(new Request('http://test'), params('other'))
    expect(res.status).toBe(404)
    expect(getDiagramGroup).toHaveBeenCalledWith('tenant-1', 'other')
  })
})

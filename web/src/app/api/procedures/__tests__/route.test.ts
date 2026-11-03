import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn().mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ withTransaction: (fn: (tx: unknown) => unknown) => fn({}) }))
vi.mock('@/db/queries/procedures', () => ({ listProcedures: vi.fn(), createProcedure: vi.fn() }))
vi.mock('@/db/queries/face-diagrams', () => ({ saveFaceDiagram: vi.fn() }))
vi.mock('@/db/queries/product-applications', () => ({ saveProductApplications: vi.fn() }))
vi.mock('@/db/queries/face-diagram-groups', () => ({
  DiagramGroupLockedError: class extends Error {},
  DiagramGroupNotFoundError: class extends Error {},
  ensurePlanningGroup: vi.fn(),
  linkGroupToProcedure: vi.fn(),
}))

import { createAuditLog } from '@/lib/audit'
import { createProcedure } from '@/db/queries/procedures'
import { ensurePlanningGroup } from '@/db/queries/face-diagram-groups'
import { POST } from '../route'

const PATIENT = '11111111-1111-4111-8111-111111111111'
const TYPE = '22222222-2222-4222-8222-222222222222'

beforeEach(() => vi.clearAllMocks())

describe('POST /api/procedures', () => {
  it('creates the planning group under the procedure practitioner and audits its id', async () => {
    vi.mocked(createProcedure).mockResolvedValue({ id: 'proc-1', practitionerId: 'prac-9' } as never)
    vi.mocked(ensurePlanningGroup).mockResolvedValue('g1')

    const res = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({
          patientId: PATIENT,
          procedureTypeId: TYPE,
          diagrams: [{ viewType: 'front', points: [{ x: 1, y: 1 }] }],
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(ensurePlanningGroup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ practitionerId: 'prac-9', procedureRecordId: 'proc-1' }),
    )
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ diagramGroupId: { old: null, new: 'g1' } }),
      }),
    )
  })
})

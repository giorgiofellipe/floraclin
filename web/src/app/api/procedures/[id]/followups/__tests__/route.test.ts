import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn().mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/followups', () => ({ recordFollowup: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))

import { createAuditLog } from '@/lib/audit'
import { recordFollowup } from '@/lib/followups'
import { POST } from '../route'

beforeEach(() => vi.clearAllMocks())

describe('POST /api/procedures/[id]/followups', () => {
  it('audits the standalone quotations a desistiu sent back to Orçamento on the procedure', async () => {
    vi.mocked(recordFollowup).mockResolvedValue({
      followupId: 'f1',
      cancelledProcedure: true,
      previousStatus: 'planned',
      releasedDiagramGroupIds: ['g1'],
    })

    const res = await POST(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ channel: 'call', outcome: 'desistiu' }) }),
      { params: Promise.resolve({ id: 'proc-1' }) },
    )

    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'procedure_record',
        entityId: 'proc-1',
        changes: expect.objectContaining({ releasedDiagramGroupIds: { old: null, new: ['g1'] } }),
      }),
    )
  })
})

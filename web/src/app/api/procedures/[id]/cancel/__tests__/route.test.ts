import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/queries/procedures', () => ({ getProcedure: vi.fn(), cancelProcedure: vi.fn() }))
vi.mock('@/db/queries/financial', () => ({ cancelLinkedFinancials: vi.fn() }))

const tx = { marker: 'tx' }
vi.mock('@/lib/tenant', () => ({
  withTransaction: (fn: (t: unknown) => unknown) => fn(tx),
}))

import { requireWrite } from '@/lib/write-access'
import { getProcedure, cancelProcedure } from '@/db/queries/procedures'
import { cancelLinkedFinancials } from '@/db/queries/financial'
import { POST } from '../route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(cancelProcedure).mockResolvedValue({ id: 'proc-1' } as never)
})

describe('POST /api/procedures/[id]/cancel', () => {
  it('cancels the financials of an approved procedure through cancelLinkedFinancials, on the same transaction', async () => {
    vi.mocked(getProcedure).mockResolvedValue({ id: 'proc-1', status: 'approved' } as never)

    const res = await POST(
      new Request('http://localhost/api/procedures/proc-1/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason: ' Paciente desistiu ' }),
      }),
      { params: Promise.resolve({ id: 'proc-1' }) },
    )

    expect(res.status).toBe(200)
    expect(cancelLinkedFinancials).toHaveBeenCalledWith(tx, 'tenant-1', 'user-1', 'proc-1', 'Paciente desistiu')
  })
})

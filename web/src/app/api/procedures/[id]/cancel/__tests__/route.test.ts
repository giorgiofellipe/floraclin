import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/queries/procedures', () => ({ getProcedure: vi.fn(), cancelProcedure: vi.fn() }))

const updates: { values?: unknown }[] = []
const tx = {
  update: vi.fn(() => {
    const write: { values?: unknown } = {}
    updates.push(write)
    const builder = {
      set: (values: unknown) => {
        write.values = values
        return builder
      },
      where: () => builder,
      returning: () => Promise.resolve([{ id: 'entry-1' }]),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }
    return builder
  }),
}
vi.mock('@/lib/tenant', () => ({
  withTransaction: (fn: (t: unknown) => unknown) => fn(tx),
}))

import { requireWrite } from '@/lib/write-access'
import { getProcedure, cancelProcedure } from '@/db/queries/procedures'
import { POST } from '../route'

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(getProcedure).mockResolvedValue({ id: 'proc-1', status: 'approved' } as never)
  vi.mocked(cancelProcedure).mockResolvedValue({ id: 'proc-1' } as never)
})

describe('POST /api/procedures/[id]/cancel', () => {
  it('stamps cancelledAt on the installments of an approved procedure, so their penalties pause from then', async () => {
    const res = await POST(
      new Request('http://localhost/api/procedures/proc-1/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Paciente desistiu' }),
      }),
      { params: Promise.resolve({ id: 'proc-1' }) },
    )

    expect(res.status).toBe(200)
    expect(updates[1].values).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(Date) })
  })
})

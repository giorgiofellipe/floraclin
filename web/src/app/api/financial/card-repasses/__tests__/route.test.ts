import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/card-payments', () => ({
  listCardRepasses: vi.fn(),
  adjustCardRepasse: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { adjustCardRepasse, listCardRepasses } from '@/db/queries/card-payments'
import { BusinessError } from '@/lib/errors'
import { GET } from '../route'
import { PATCH } from '../[id]/route'

function patch(body: unknown) {
  return PATCH(
    new Request('http://test/api/financial/card-repasses/r1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'r1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 't1', userId: 'u1', role: 'owner' } as never)
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 't1', userId: 'u1', role: 'owner' },
    blocked: null,
  } as never)
})

describe('PATCH /api/financial/card-repasses/[id]', () => {
  it('returns 400 for an impossible calendar day', async () => {
    const res = await patch({ netAmount: 100, expectedDate: '2026-02-31' })

    expect(res.status).toBe(400)
    expect(adjustCardRepasse).not.toHaveBeenCalled()
  })

  it('maps BusinessError to 409 with its code', async () => {
    vi.mocked(adjustCardRepasse).mockRejectedValue(new BusinessError('REPASSE_CANCELLED', 'Repasse já recebido'))

    const res = await patch({ netAmount: 100, expectedDate: '2026-11-03' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Repasse já recebido', code: 'REPASSE_CANCELLED' })
  })

  it('adjusts with the session tenant and user', async () => {
    vi.mocked(adjustCardRepasse).mockResolvedValue(undefined)

    const res = await patch({ netAmount: 97.5, expectedDate: '2026-11-03' })

    expect(res.status).toBe(200)
    expect(adjustCardRepasse).toHaveBeenCalledWith('t1', 'u1', 'r1', {
      netAmount: 97.5,
      expectedDate: '2026-11-03',
    })
  })
})

describe('GET /api/financial/card-repasses', () => {
  it('returns rows with totals and forwards parsed filters', async () => {
    vi.mocked(listCardRepasses).mockResolvedValue({ rows: [{ id: 'r1' }], total: 1, pendingNetTotal: 50 } as never)

    const res = await GET(
      new Request(
        'http://test/api/financial/card-repasses?dateFrom=2026-10-01&dateTo=2026-10-31&terminalId=00000000-0000-4000-8000-000000000001&status=pending&page=2&limit=10',
      ),
    )

    expect(await res.json()).toEqual({ data: [{ id: 'r1' }], total: 1, pendingNetTotal: 50 })
    expect(listCardRepasses).toHaveBeenCalledWith('t1', {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      terminalId: '00000000-0000-4000-8000-000000000001',
      status: 'pending',
      page: 2,
      limit: 10,
    })
  })

  it('returns 400 for a malformed date filter', async () => {
    const res = await GET(new Request('http://test/api/financial/card-repasses?dateFrom=2026-02-31&dateTo=2026-10-31'))

    expect(res.status).toBe(400)
    expect(listCardRepasses).not.toHaveBeenCalled()
  })
})

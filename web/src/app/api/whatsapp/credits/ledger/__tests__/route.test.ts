import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

const requireRole = vi.fn()
const getOrCreateCurrentPeriod = vi.fn()
const listCreditPeriods = vi.fn()
const listLedgerEntries = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }))
vi.mock('@/db/queries/whatsapp-credits', () => ({
  getOrCreateCurrentPeriod: (...a: unknown[]) => getOrCreateCurrentPeriod(...a),
}))
vi.mock('@/db/queries/whatsapp-credit-history', async () => {
  const actual = await vi.importActual<typeof import('@/db/queries/whatsapp-credit-history')>(
    '@/db/queries/whatsapp-credit-history',
  )
  return {
    ...actual,
    listCreditPeriods: (...a: unknown[]) => listCreditPeriods(...a),
    listLedgerEntries: (...a: unknown[]) => listLedgerEntries(...a),
  }
})

import { GET } from '../route'
import { encodeLedgerCursor } from '@/db/queries/whatsapp-credit-history'

const P1 = { id: 'p1', start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z', used: 3, total: 10 }
const P2 = { id: 'p2', start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z', used: 1, total: 10 }

describe('GET /api/whatsapp/credits/ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ tenantId: 'tenant-1', role: 'owner' })
    getOrCreateCurrentPeriod.mockResolvedValue({ id: 'p2' })
    listCreditPeriods.mockResolvedValue([P2, P1])
    listLedgerEntries.mockResolvedValue({ entries: [], nextCursor: null })
  })

  it('uses the current period when none is given', async () => {
    const res = await GET(new Request('http://x/api/whatsapp/credits/ledger'))
    expect(res.status).toBe(200)
    expect(listLedgerEntries).toHaveBeenCalledWith('tenant-1', 'p2', null)
    expect((await res.json()).periodId).toBe('p2')
  })

  it('returns 404 for a period of another tenant', async () => {
    const res = await GET(new Request('http://x/api/whatsapp/credits/ledger?periodId=00000000-0000-4000-8000-000000000999'))
    expect(res.status).toBe(404)
    expect(listLedgerEntries).not.toHaveBeenCalled()
  })

  it('returns 400 for a garbage cursor', async () => {
    const res = await GET(new Request('http://x/api/whatsapp/credits/ledger?cursor=%%%'))
    expect(res.status).toBe(400)
  })

  it('passes a decoded cursor through', async () => {
    const id = '00000000-0000-4000-8000-0000000000a9'
    const cursor = encodeLedgerCursor({ createdAt: new Date('2026-10-15T12:00:00.000Z'), id })
    await GET(new Request(`http://x/api/whatsapp/credits/ledger?cursor=${cursor}`))
    expect(listLedgerEntries).toHaveBeenCalledWith('tenant-1', 'p2', { createdAt: new Date('2026-10-15T12:00:00.000Z'), id })
  })

  it('returns 400 for a cursor whose id is not a uuid', async () => {
    const cursor = encodeLedgerCursor({ createdAt: new Date('2026-10-15T12:00:00.000Z'), id: 'l9' })
    const res = await GET(new Request(`http://x/api/whatsapp/credits/ledger?cursor=${cursor}`))
    expect(res.status).toBe(400)
  })

  it('is owner only', async () => {
    requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET(new Request('http://x/api/whatsapp/credits/ledger'))
    expect(res.status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('owner')
  })
})

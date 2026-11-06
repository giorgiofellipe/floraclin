import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/cash-movements', () => ({
  listCashMovements: vi.fn(),
  getLedgerSummary: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getLedgerSummary, listCashMovements } from '@/db/queries/cash-movements'
import { GET } from '../route'

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

function callGet(role: string) {
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1', role } as never)
  return GET(
    new Request(`http://localhost/api/financial/ledger?dateFrom=2026-11-01&dateTo=2026-11-30&accountId=${ACCOUNT_ID}`),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listCashMovements).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 } as never)
  vi.mocked(getLedgerSummary).mockResolvedValue({} as never)
})

describe('GET /api/financial/ledger filtered by account', () => {
  it.each(['owner', 'financial'])('asks for the account balance in the running balance for %s', async (role) => {
    const res = await callGet(role)

    expect(res.status).toBe(200)
    expect(listCashMovements).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ accountId: ACCOUNT_ID }),
      { accountBalance: true },
    )
  })

  // The accounts API hides balances from a receptionist; the ledger must not
  // hand them back through the running balance (opening balance included).
  it('keeps the account balance from a receptionist, who still reads the movements', async () => {
    const res = await callGet('receptionist')

    expect(res.status).toBe(200)
    expect(listCashMovements).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ accountId: ACCOUNT_ID }),
      { accountBalance: false },
    )
  })

  it('refuses a practitioner', async () => {
    const res = await callGet('practitioner')

    expect(res.status).toBe(403)
    expect(listCashMovements).not.toHaveBeenCalled()
  })
})

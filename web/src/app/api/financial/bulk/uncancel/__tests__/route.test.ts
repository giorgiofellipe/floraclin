import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  uncancelEntries: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { uncancelEntries } from '@/db/queries/financial'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/financial/bulk/uncancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { entryIds: ['11111111-1111-4111-8111-111111111111'], reason: 'Erro no cancelamento' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(uncancelEntries).mockResolvedValue({ uncancelledCount: 1 })
})

describe('POST /api/financial/bulk/uncancel', () => {
  it('allows owner and financial, rejects everyone else', async () => {
    for (const role of ['owner', 'financial']) {
      vi.mocked(getAuthContext).mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role,
      } as never)

      const res = await POST(makeRequest(validBody))

      expect(res.status).toBe(200)
    }

    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'receptionist',
    } as never)
    vi.mocked(uncancelEntries).mockClear()

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(403)
    expect(uncancelEntries).not.toHaveBeenCalled()
  })

  it('rejects an empty entryIds with 400', async () => {
    const res = await POST(makeRequest({ ...validBody, entryIds: [] }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(uncancelEntries).not.toHaveBeenCalled()
  })

  it('rejects an empty reason with 400', async () => {
    const res = await POST(makeRequest({ ...validBody, reason: '' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(uncancelEntries).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code', async () => {
    vi.mocked(uncancelEntries).mockRejectedValue(
      new BusinessError('ENTRIES_NOT_FOUND', 'Cobrança não encontrada')
    )

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'Cobrança não encontrada', code: 'ENTRIES_NOT_FOUND' })
  })

  it('returns the query result on success', async () => {
    vi.mocked(uncancelEntries).mockResolvedValue({ uncancelledCount: 3 })

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: { uncancelledCount: 3 } })
    expect(uncancelEntries).toHaveBeenCalledWith('tenant-1', 'user-1', validBody)
  })
})

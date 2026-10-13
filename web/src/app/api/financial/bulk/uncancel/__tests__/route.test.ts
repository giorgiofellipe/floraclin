import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  uncancelEntries: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
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

const AUTH_OK = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(uncancelEntries).mockResolvedValue({ uncancelledCount: 1 })
})

describe('POST /api/financial/bulk/uncancel', () => {
  it('asks the guard for owner and financial only', async () => {
    await POST(makeRequest(validBody))

    expect(requireWrite).toHaveBeenCalledWith('owner', 'financial')
  })

  it('returns the guard response and reactivates nothing when it blocks', async () => {
    // A wrong role and a lapsed subscription both arrive here the same way.
    vi.mocked(requireWrite).mockResolvedValueOnce({
      ctx: null,
      blocked: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

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

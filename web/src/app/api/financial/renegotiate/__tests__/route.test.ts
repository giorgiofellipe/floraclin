import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/renegotiation', () => ({
  renegotiateCharges: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { renegotiateCharges } from '@/db/queries/renegotiation'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'

function callPost(body: unknown) {
  return POST(
    new Request('http://localhost/api/financial/renegotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const validBody = {
  entryIds: [ENTRY_ID],
  newInstallmentCount: 2,
  description: 'Renegociação',
}

const AUTH_OK = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(renegotiateCharges).mockResolvedValue({ newEntry: { id: 'entry-2' } } as never)
})

describe('POST /api/financial/renegotiate', () => {
  it('asks the guard for owner and financial', async () => {
    await callPost(validBody)

    expect(requireWrite).toHaveBeenCalledWith('owner', 'financial')
  })

  it('returns the guard response and renegotiates nothing when it blocks', async () => {
    vi.mocked(requireWrite).mockResolvedValueOnce({
      ctx: null,
      blocked: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

    const res = await callPost(validBody)

    expect(res.status).toBe(403)
    expect(renegotiateCharges).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with 400', async () => {
    const res = await callPost({ ...validBody, newInstallmentCount: 0 })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(renegotiateCharges).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code instead of a 500', async () => {
    vi.mocked(renegotiateCharges).mockRejectedValue(
      new BusinessError('ENTRY_ALREADY_PAID', 'Cobrança já quitada, não há o que renegociar.')
    )

    const res = await callPost(validBody)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: 'Cobrança já quitada, não há o que renegociar.',
      code: 'ENTRY_ALREADY_PAID',
    })
  })

  it('returns the result on success', async () => {
    const res = await callPost(validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: { newEntry: { id: 'entry-2' } } })
    expect(renegotiateCharges).toHaveBeenCalledWith('tenant-1', 'user-1', {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 2,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  bulkPayInstallments: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { bulkPayInstallments } from '@/db/queries/financial'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const installmentId = '11111111-1111-4111-8111-111111111111'

function callPost(body: unknown) {
  return POST(
    new Request('http://localhost/api/financial/bulk/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const validBody = { installmentIds: [installmentId], paymentMethod: 'pix' }

const AUTH_OK = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

const RESULTS = [{ installmentId, paymentRecord: { id: 'pay-1' }, allocation: {} }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(bulkPayInstallments).mockResolvedValue(RESULTS as never)
})

describe('POST /api/financial/bulk/pay', () => {
  it('asks the guard for owner, receptionist and financial', async () => {
    await callPost(validBody)

    expect(requireWrite).toHaveBeenCalledWith('owner', 'receptionist', 'financial')
  })

  it('returns the guard response and pays nothing when it blocks', async () => {
    vi.mocked(requireWrite).mockResolvedValueOnce({
      ctx: null,
      blocked: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

    const res = await callPost(validBody)

    expect(res.status).toBe(403)
    expect(bulkPayInstallments).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with 400', async () => {
    const res = await callPost({ installmentIds: [], paymentMethod: 'pix' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(bulkPayInstallments).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code', async () => {
    vi.mocked(bulkPayInstallments).mockRejectedValue(
      new BusinessError('INSTALLMENTS_NOT_PAYABLE', 'Parcelas não encontradas ou já pagas/canceladas'),
    )

    const res = await callPost(validBody)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: 'Parcelas não encontradas ou já pagas/canceladas',
      code: 'INSTALLMENTS_NOT_PAYABLE',
    })
  })

  it('pays the installments and returns the results on success', async () => {
    const res = await callPost(validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: RESULTS })
    expect(bulkPayInstallments).toHaveBeenCalledWith('tenant-1', 'user-1', {
      installmentIds: [installmentId],
      paymentMethod: 'pix',
      paidAt: undefined,
    })
  })

  it('passes the maquininha through to the bulk payment', async () => {
    const card = { terminalId: '22222222-2222-4222-8222-222222222222', installmentCount: 3 }

    const res = await callPost({ ...validBody, paymentMethod: 'credit_card', card })

    expect(res.status).toBe(200)
    expect(bulkPayInstallments).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({ paymentMethod: 'credit_card', card }),
    )
  })
})

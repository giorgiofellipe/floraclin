import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  recordPayment: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { recordPayment } from '@/db/queries/financial'
import { BusinessError } from '@/lib/errors'
import { PUT } from '../route'

const installmentId = '11111111-1111-4111-8111-111111111111'

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/financial/installments/${installmentId}/pay`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function callPut(body: unknown, id = installmentId) {
  return PUT(makeRequest(body), { params: Promise.resolve({ id }) })
}

const validBody = { amount: 150, paymentMethod: 'pix' }

const AUTH_OK = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(recordPayment).mockResolvedValue({ allocation: [{ id: 'inst-1', amount: 150 }] } as never)
  vi.mocked(createAuditLog).mockResolvedValue(undefined as never)
})

describe('PUT /api/financial/installments/[id]/pay', () => {
  it('asks the guard for owner, receptionist and financial', async () => {
    await callPut(validBody)

    expect(requireWrite).toHaveBeenCalledWith('owner', 'receptionist', 'financial')
  })

  it('returns the guard response and records nothing when it blocks', async () => {
    // A wrong role and a lapsed subscription both arrive here the same way.
    vi.mocked(requireWrite).mockResolvedValueOnce({
      ctx: null,
      blocked: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

    const res = await callPut(validBody)

    expect(res.status).toBe(403)
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with 400', async () => {
    const res = await callPut({ amount: 150, paymentMethod: 'bitcoin' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code instead of a 500', async () => {
    vi.mocked(recordPayment).mockRejectedValue(
      new BusinessError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada ou não pertence a esta clínica')
    )

    const res = await callPut(validBody)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: 'Parcela não encontrada ou não pertence a esta clínica',
      code: 'INSTALLMENT_NOT_FOUND',
    })
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('records the payment, writes an audit log and returns the result on success', async () => {
    const res = await callPut(validBody)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: { allocation: [{ id: 'inst-1', amount: 150 }] } })
    expect(recordPayment).toHaveBeenCalledWith('tenant-1', 'user-1', {
      installmentId,
      amount: 150,
      paymentMethod: 'pix',
      paidAt: undefined,
      notes: undefined,
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'update',
        entityType: 'installment',
        entityId: installmentId,
      })
    )
  })
})

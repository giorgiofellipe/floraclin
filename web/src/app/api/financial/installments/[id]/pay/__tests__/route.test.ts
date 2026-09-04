import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  recordPayment: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(recordPayment).mockResolvedValue({ allocation: [{ id: 'inst-1', amount: 150 }] } as never)
  vi.mocked(createAuditLog).mockResolvedValue(undefined as never)
})

describe('PUT /api/financial/installments/[id]/pay', () => {
  it('allows owner, receptionist and financial, rejects everyone else', async () => {
    for (const role of ['owner', 'receptionist', 'financial']) {
      vi.mocked(getAuthContext).mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role,
      } as never)

      const res = await callPut(validBody)

      expect(res.status).toBe(200)
    }

    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'practitioner',
    } as never)
    vi.mocked(recordPayment).mockClear()

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

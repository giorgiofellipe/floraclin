import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/financial-quote', () => ({
  getInstallmentQuote: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getInstallmentQuote } from '@/db/queries/financial-quote'
import { BusinessError } from '@/lib/errors'
import { GET } from '../route'

function makeRequest(url: string) {
  return new Request(url)
}

function callGet(url: string, id = 'inst-1') {
  return GET(makeRequest(url), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  // BR noon on 2026-08-03 (15:00 UTC), so brToday() is deterministic.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-03T15:00:00Z'))
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getInstallmentQuote).mockResolvedValue({ total: 100 } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/financial/installments/[id]/quote', () => {
  it('allows owner, receptionist and financial, rejects everyone else', async () => {
    for (const role of ['owner', 'receptionist', 'financial']) {
      vi.mocked(getAuthContext).mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role,
      } as never)

      const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')

      expect(res.status).toBe(200)
    }

    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'practitioner',
    } as never)
    vi.mocked(getInstallmentQuote).mockClear()

    const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')

    expect(res.status).toBe(403)
    expect(getInstallmentQuote).not.toHaveBeenCalled()
  })

  it('prices as of now when paidAt is missing', async () => {
    const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')

    expect(res.status).toBe(200)
    const [, , asOf] = vi.mocked(getInstallmentQuote).mock.calls[0]
    expect(asOf).toBeInstanceOf(Date)
    expect((asOf as Date).getTime()).toBe(new Date('2026-08-03T15:00:00Z').getTime())
  })

  it('passes a valid past paidAt through as a Date', async () => {
    const res = await callGet(
      'http://localhost/api/financial/installments/inst-1/quote?paidAt=2026-08-01T12:00:00-03:00'
    )

    expect(res.status).toBe(200)
    expect(getInstallmentQuote).toHaveBeenCalledWith(
      'tenant-1',
      'inst-1',
      new Date('2026-08-01T12:00:00-03:00')
    )
  })

  it('rejects a paidAt after the end of the current BR day with 400', async () => {
    const res = await callGet(
      'http://localhost/api/financial/installments/inst-1/quote?paidAt=2026-08-05T00:00:00-03:00'
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(getInstallmentQuote).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code', async () => {
    vi.mocked(getInstallmentQuote).mockRejectedValue(
      new BusinessError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada ou não pertence a esta clínica')
    )

    const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: 'Parcela não encontrada ou não pertence a esta clínica',
      code: 'INSTALLMENT_NOT_FOUND',
    })
  })
})

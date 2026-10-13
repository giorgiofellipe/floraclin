import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/financial-quote', () => ({
  getInstallmentQuote: vi.fn(),
}))

import { requireRole } from '@/lib/auth'
import { getInstallmentQuote, type InstallmentQuoteResult } from '@/db/queries/financial-quote'
import { BusinessError, ForbiddenError } from '@/lib/errors'
import { GET } from '../route'

function makeRequest(url: string) {
  return new Request(url)
}

const INSTALLMENT_ID = '00000000-0000-4000-8000-000000000001'

function callGet(url: string, id: string = INSTALLMENT_ID) {
  return GET(makeRequest(url), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  // BR noon on 2026-08-03 (15:00 UTC), so brToday() is deterministic.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-03T15:00:00Z'))
  vi.mocked(requireRole).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  const quote: InstallmentQuoteResult = {
    remainingPrincipal: 100,
    fineAmount: 0,
    interestAmount: 0,
    totalDue: 100,
    asOf: '2026-08-03T15:00:00.000Z',
  }
  vi.mocked(getInstallmentQuote).mockResolvedValue(quote)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/financial/installments/[id]/quote', () => {
  it('asks requireRole for owner, receptionist and financial and answers 403 when it refuses', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new ForbiddenError())

    const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')

    expect(requireRole).toHaveBeenCalledWith('owner', 'receptionist', 'financial')
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
      INSTALLMENT_ID,
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

  it('rejects a malformed installment id with 400 instead of reaching the database', async () => {
    const res = await callGet(
      'http://localhost/api/financial/installments/not-a-uuid/quote',
      'not-a-uuid'
    )

    expect(res.status).toBe(400)
    expect(getInstallmentQuote).not.toHaveBeenCalled()
  })

  it('maps a BusinessError from the query to 409 with error and code', async () => {
    vi.mocked(getInstallmentQuote).mockRejectedValue(
      new BusinessError('PAYMENT_BEFORE_LATER_PAYMENT', 'Já existe um pagamento em 01/08/2026 na parcela 1.')
    )

    const res = await callGet('http://localhost/api/financial/installments/inst-1/quote')
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: 'Já existe um pagamento em 01/08/2026 na parcela 1.',
      code: 'PAYMENT_BEFORE_LATER_PAYMENT',
    })
  })
})

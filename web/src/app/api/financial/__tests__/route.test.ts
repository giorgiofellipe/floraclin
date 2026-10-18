import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/db/queries/financial', () => ({
  listFinancialEntries: vi.fn(),
  createFinancialEntry: vi.fn(),
  recordPayment: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { createFinancialEntry, recordPayment } from '@/db/queries/financial'
import { reportSideEffectFailure } from '@/lib/observability'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const TERMINAL_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY = { id: 'entry-1', installmentIds: ['inst-1'] }
const AUTH_OK = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

const cardBody = {
  patientId: PATIENT_ID,
  description: 'Botox',
  totalAmount: 3000,
  installmentCount: 1,
  paymentMethod: 'credit_card',
  card: { terminalId: TERMINAL_ID, installmentCount: 6 },
}

function callPost(body: unknown) {
  return POST(
    new Request('http://localhost/api/financial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(createFinancialEntry).mockResolvedValue(ENTRY as never)
  vi.mocked(recordPayment).mockResolvedValue({} as never)
})

describe('POST /api/financial with a card payment', () => {
  it('creates the charge and pays its only installment in full by card', async () => {
    const res = await callPost(cardBody)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toEqual({ success: true, data: ENTRY })
    expect(recordPayment).toHaveBeenCalledWith('tenant-1', 'user-1', {
      installmentId: 'inst-1',
      amount: 3000,
      paymentMethod: 'credit_card',
      card: cardBody.card,
      expectedTotalDue: 3000,
    })
  })

  it('keeps the charge and reports the message when the payment fails with a BusinessError', async () => {
    vi.mocked(recordPayment).mockRejectedValue(new BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada'))

    const res = await callPost(cardBody)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toEqual({ success: true, data: ENTRY, paymentError: 'Maquininha não encontrada' })
    expect(reportSideEffectFailure).not.toHaveBeenCalled()
  })

  it('keeps the charge, answers with the generic message and reports an unexpected payment error', async () => {
    const failure = new Error('db down')
    vi.mocked(recordPayment).mockRejectedValue(failure)

    const res = await callPost(cardBody)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.paymentError).toBe('Não foi possível registrar o pagamento. A cobrança ficou pendente.')
    expect(reportSideEffectFailure).toHaveBeenCalledWith(failure, expect.objectContaining({ area: 'financial' }))
  })

  it('records no payment for a charge without a card', async () => {
    const res = await callPost({ ...cardBody, paymentMethod: 'pix', card: undefined })

    expect(res.status).toBe(201)
    expect(recordPayment).not.toHaveBeenCalled()
  })
})

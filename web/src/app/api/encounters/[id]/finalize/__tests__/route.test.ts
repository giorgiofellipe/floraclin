import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/encounter-finalize', () => ({ finalizeEncounter: vi.fn() }))
vi.mock('@/db/queries/financial', () => ({ recordPayment: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/tenant-settings', () => ({ getDefaultPackageValidityMonths: () => null }))
vi.mock('@/lib/api-error', () => ({ handleApiError: vi.fn() }))
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ settings: {} }] }) }) }) },
}))

import { requireWrite } from '@/lib/write-access'
import { finalizeEncounter } from '@/lib/encounter-finalize'
import { recordPayment } from '@/db/queries/financial'
import { reportSideEffectFailure } from '@/lib/observability'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const ENCOUNTER_ID = '00000000-0000-4000-8000-0000000000a1'
const TERMINAL_ID = '00000000-0000-4000-8000-0000000000c1'

const cart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [
    {
      procedureTypeId: '00000000-0000-4000-8000-000000000bbb',
      procedureTypeName: 'Botox',
      sessions: 1,
      defaultPrice: 800,
      sourceTemplateLineId: null,
    },
  ],
  totalOverride: null,
}

function call(overrides: Record<string, unknown>) {
  const body = {
    cart,
    draftRecordIds: ['00000000-0000-4000-8000-00000000d001'],
    patientId: '00000000-0000-4000-8000-000000000002',
    financialPlan: { totalAmount: '800.00', installmentCount: 6, paymentMethod: 'credit_card' },
    consents: [],
    ...overrides,
  }
  return POST(
    new Request(`http://localhost/api/encounters/${ENCOUNTER_ID}/finalize`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ENCOUNTER_ID }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' },
    blocked: null,
  } as never)
  vi.mocked(finalizeEncounter).mockResolvedValue({
    encounterId: ENCOUNTER_ID,
    patientPackageId: null,
    procedureRecordIds: ['rec-1'],
    financialEntryId: 'fe-1',
    firstInstallmentId: 'inst-1',
  })
})

describe('POST /api/encounters/[id]/finalize card payment', () => {
  it('charges the first installment with the plan card terms after finalizing', async () => {
    const res = await call({ cardPayment: { terminalId: TERMINAL_ID, expectedRate: 8.99 } })

    expect(res.status).toBe(200)
    expect(recordPayment).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        installmentId: 'inst-1',
        amount: 800,
        expectedTotalDue: 800,
        paymentMethod: 'credit_card',
        card: { terminalId: TERMINAL_ID, installmentCount: 6, expectedRate: 8.99 },
      }),
    )
    expect((await res.json()).paymentError).toBeUndefined()
  })

  it('does not charge when the clinic did not take the card payment now', async () => {
    await call({})
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('returns success with the BusinessError message when the payment is refused', async () => {
    vi.mocked(recordPayment).mockRejectedValue(new BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada'))

    const res = await call({ cardPayment: { terminalId: TERMINAL_ID, expectedRate: 8.99 } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.financialEntryId).toBe('fe-1')
    expect(json.paymentError).toBe('Maquininha não encontrada')
    expect(reportSideEffectFailure).not.toHaveBeenCalled()
  })

  it('returns success with a generic paymentError and reports an unexpected failure', async () => {
    const boom = new Error('connection reset')
    vi.mocked(recordPayment).mockRejectedValue(boom)

    const res = await call({ cardPayment: { terminalId: TERMINAL_ID, expectedRate: 8.99 } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.paymentError).toBe('Não foi possível registrar o pagamento. A cobrança ficou pendente.')
    expect(reportSideEffectFailure).toHaveBeenCalledWith(boom, expect.objectContaining({ area: 'encounter-finalize' }))
  })

  it.each([
    {
      name: 'debit in 3 installments',
      overrides: { financialPlan: { totalAmount: '800.00', installmentCount: 3, paymentMethod: 'debit_card' } },
    },
    {
      name: 'cardPayment with a pix plan',
      overrides: {
        financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
        cardPayment: { terminalId: TERMINAL_ID, expectedRate: 8.99 },
      },
    },
    {
      name: 'cardPayment without the expected rate',
      overrides: { cardPayment: { terminalId: TERMINAL_ID } },
    },
    {
      name: 'unknown payment method',
      overrides: { financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'boleto' } },
    },
  ])('rejects $name with 400 before committing anything', async ({ overrides }) => {
    const res = await call(overrides)

    expect(res.status).toBe(400)
    expect(finalizeEncounter).not.toHaveBeenCalled()
    expect(recordPayment).not.toHaveBeenCalled()
  })
})

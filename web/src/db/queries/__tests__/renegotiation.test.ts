import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BusinessError } from '@/lib/errors'
import { chain, chainCapturing, whereParams, type Capture } from '@/tests/mocks/drizzle-tx'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

function makeTx() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
}

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'
const NEW_ENTRY_ID = '00000000-0000-0000-0000-00000000e002'

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

describe('renegotiateCharges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prices penalties through the engine, matching what the payment dialog would quote', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    // 1. Eligibility select
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: ENTRY_ID,
          patientId: PATIENT_ID,
          description: 'Tratamento X',
          totalAmount: '750.00',
          status: 'pending',
        },
      ]),
    )

    // 2. Installment lock
    tx.select.mockReturnValueOnce(chain([
      {
        id: INSTALLMENT_ID,
        financialEntryId: ENTRY_ID,
        status: 'pending',
        amount: '750.00',
        amountPaid: '0',
        dueDate: '2026-05-22',
        appliedFineType: 'percentage',
        appliedFineValue: '2.00',
        appliedInterestRate: '1.00',
        appliedGracePeriodDays: 0,
        penaltyPauses: [],
        cancelledAt: null,
      },
    ]))

    // 3. Post-lock status re-read
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }]))

    // 4. Live payment records for the locked installments
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'pay-1',
          installmentId: INSTALLMENT_ID,
          amount: '1.00',
          paidAt: new Date('2026-09-03T14:04:50.000Z'),
          recordedAt: new Date('2026-09-03T14:04:50.000Z'),
        },
      ]),
    )

    // 5. Financial settings, for the replacement's installment terms
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))

    tx.update.mockReturnValueOnce(chain(undefined)) // cancel unpaid installments
    tx.update.mockReturnValueOnce(chain(undefined)) // mark original entries renegotiated

    tx.insert.mockReturnValueOnce(chain([{ id: NEW_ENTRY_ID }])) // new financial entry
    tx.insert.mockReturnValueOnce(chain(undefined)) // renegotiation link
    tx.insert.mockReturnValueOnce(chain(undefined)) // new installments
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log: original entry
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log: new entry

    const result = await renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    // The payment of 1 on Sep 3 covers 1 of the 26 interest then owed,
    // carrying 25 and setting the fine at 15; ten more days on 750 at 1%/month
    // is 2.50, so 15 + 25 + 2.50 = 42.50.
    expect(result.breakdown).toEqual([
      { entryId: ENTRY_ID, remainingPrincipal: 750, penalties: 42.5 },
    ])
    expect(result.penaltiesIncluded).toBe(42.5)
  })

  it('refuses with ENTRY_ALREADY_PAID when a concurrent payment settles the entry after the first read', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    // 1. Eligibility select, before the lock: still pending
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: ENTRY_ID,
          patientId: PATIENT_ID,
          description: 'Tratamento X',
          totalAmount: '750.00',
          status: 'pending',
        },
      ]),
    )

    // 2. Installment lock: the payment that won the race already settled the row
    tx.select.mockReturnValueOnce(chain([
      {
        id: INSTALLMENT_ID,
        financialEntryId: ENTRY_ID,
        status: 'paid',
        amount: '750.00',
        dueDate: '2026-05-22',
        appliedFineType: 'percentage',
        appliedFineValue: '2.00',
        appliedInterestRate: '1.00',
      },
    ]))

    // 3. Post-lock status re-read sees the committed payment
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'paid' }]))

    const promise = renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    await expect(promise).rejects.toBeInstanceOf(BusinessError)
    await expect(promise).rejects.toMatchObject({
      code: 'ENTRY_ALREADY_PAID',
      message: 'Cobrança já quitada, não há o que renegociar.',
    })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('refuses with NOTHING_TO_RENEGOTIATE when every installment is paid, even with newTotalAmount supplied', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    // 1. Eligibility select
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: ENTRY_ID,
          patientId: PATIENT_ID,
          description: 'Tratamento X',
          totalAmount: '750.00',
          status: 'pending',
        },
      ]),
    )

    // 2. Installment lock: nothing left unpaid
    tx.select.mockReturnValueOnce(chain([
      {
        id: INSTALLMENT_ID,
        financialEntryId: ENTRY_ID,
        status: 'paid',
        amount: '750.00',
        dueDate: '2026-05-22',
        appliedFineType: 'percentage',
        appliedFineValue: '2.00',
        appliedInterestRate: '1.00',
      },
    ]))

    // 3. Post-lock status re-read
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }]))

    // 4. Live payment records
    tx.select.mockReturnValueOnce(chain([]))

    // 5. Financial settings, for the replacement's installment terms
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))

    const promise = renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      newTotalAmount: 750,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    await expect(promise).rejects.toBeInstanceOf(BusinessError)
    await expect(promise).rejects.toMatchObject({
      code: 'NOTHING_TO_RENEGOTIATE',
      message: 'Não há saldo pendente para renegociar.',
    })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('stamps cancelledAt on the originals, flags the replacement as created from renegotiation, and writes the creation terms on its installments', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: ENTRY_ID, patientId: PATIENT_ID, description: 'X', totalAmount: '750.00', status: 'pending' }]),
    )
    tx.select.mockReturnValueOnce(chain([
      {
        id: INSTALLMENT_ID,
        financialEntryId: ENTRY_ID,
        status: 'pending',
        amount: '750.00',
        dueDate: '2026-10-01',
        appliedFineType: 'percentage',
        appliedFineValue: '2.00',
        appliedInterestRate: '1.00',
        appliedGracePeriodDays: 0,
        penaltyPauses: [],
        cancelledAt: null,
      },
    ]))
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }]))
    tx.select.mockReturnValueOnce(chain([])) // live payments
    tx.select.mockReturnValueOnce(
      chain([{ fineType: 'fixed', fineValue: '5.00', monthlyInterestPercent: '0.50', gracePeriodDays: 3 }]),
    ) // financial settings

    const cancelUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, cancelUpdate))
    tx.update.mockReturnValueOnce(chain(undefined))
    const entryInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: NEW_ENTRY_ID }], entryInsert))
    tx.insert.mockReturnValueOnce(chain(undefined)) // renegotiation link
    const installmentsInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, installmentsInsert))
    tx.insert.mockReturnValue(chain(undefined)) // audit logs

    await renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    expect(cancelUpdate.value).toMatchObject({
      status: 'cancelled',
      cancelledAt: new Date('2026-09-13T14:04:50.000Z'),
    })
    expect(entryInsert.value).toMatchObject({ createdFromRenegotiation: true })
    expect(installmentsInsert.value).toEqual([
      expect.objectContaining({
        appliedFineType: 'fixed',
        appliedFineValue: '5.00',
        appliedInterestRate: '0.50',
        appliedGracePeriodDays: 3,
      }),
    ])
  })
  it('cancels only the pending installments of the originals and leaves an already cancelled one, and its cancelled_at, alone', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const { installments } = await import('@/db/schema')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    const CANCELLED_ID = '00000000-0000-0000-0000-00000000i0cc'

    const installmentCancel: Capture = {}
    tx.update.mockImplementation((table: unknown) =>
      table === installments ? chainCapturing(undefined, installmentCancel) : chain(undefined),
    )
    tx.insert.mockReturnValueOnce(chain([{ id: NEW_ENTRY_ID }]))
    tx.insert.mockReturnValue(chain(undefined))

    tx.select.mockReturnValueOnce(
      chain([{ id: ENTRY_ID, patientId: PATIENT_ID, description: 'X', totalAmount: '1500.00', status: 'partial' }]),
    )
    const pricing = {
      financialEntryId: ENTRY_ID,
      amount: '750.00',
      dueDate: '2026-10-01',
      appliedFineType: 'percentage',
      appliedFineValue: '2.00',
      appliedInterestRate: '1.00',
      appliedGracePeriodDays: 0,
      penaltyPauses: [],
    }
    tx.select.mockReturnValueOnce(chain([
      { ...pricing, id: CANCELLED_ID, status: 'cancelled', cancelledAt: '2026-08-01T15:00:00.000Z' },
      { ...pricing, id: INSTALLMENT_ID, status: 'pending', cancelledAt: null },
    ]))
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'partial' }]))
    tx.select.mockReturnValueOnce(chain([])) // live payments
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))

    await renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    expect(whereParams(installmentCancel)).toContain(INSTALLMENT_ID)
    expect(whereParams(installmentCancel)).not.toContain(CANCELLED_ID)
  })
})

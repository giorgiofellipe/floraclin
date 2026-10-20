import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chain, chainCapturing, isLock, routedTx, tableOf } from '@/tests/mocks/drizzle-tx'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const enqueueMetaEventMock = vi.fn()
const resolveMetaEventPrerequisitesMock = vi.fn()
const claimAndSendPendingEventMock = vi.fn()
vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: (...args: unknown[]) => enqueueMetaEventMock(...args),
  resolveMetaEventPrerequisites: (...args: unknown[]) => resolveMetaEventPrerequisitesMock(...args),
  claimAndSendPendingEvent: (...args: unknown[]) => claimAndSendPendingEventMock(...args),
}))

const resolveProspectForPatientMock = vi.fn()
vi.mock('@/lib/meta/resolve-prospect', () => ({
  resolveProspectForPatient: (...args: unknown[]) => resolveProspectForPatientMock(...args),
}))

const createCardPaymentTxMock = vi.fn()
vi.mock('../card-payments', () => ({
  createCardPaymentTx: (...args: unknown[]) => createCardPaymentTxMock(...args),
}))

const reportSideEffectFailureMock = vi.fn()
vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'

const PREREQUISITES = {
  optedOut: false,
  connection: {
    datasetId: 'dataset-1',
    accessToken: 'tok-1',
    testEventCode: null,
    advancedMatchingEnabled: true,
  },
  attribution: null,
}

/**
 * `transaction` is drizzle's nested transaction, which the postgres-js driver
 * issues as SAVEPOINT / ROLLBACK TO SAVEPOINT: a throw inside the callback
 * comes back out, and the outer handle keeps working afterwards. `savepoint`
 * is the handle that callback receives. Copied from financial-meta.test.ts.
 */
function makeTx() {
  const savepoint = { insert: vi.fn(), select: vi.fn() }
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    savepoint,
    transaction: vi.fn(async (cb: (sp: unknown) => unknown) => cb(savepoint)),
  }
}

// Fixture unless a test says otherwise: R$750, due 2026-05-22, no prior
// payments, fine 2% percentage, interest 1%/month, grace 0.
const DUE_DATE = '2026-05-22'

// The installment row recordPayment locks.
function lockedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    installmentNumber: 1,
    status: 'pending',
    amount: '750.00',
    amountPaid: '0',
    dueDate: DUE_DATE,
    financialEntryId: ENTRY_ID,
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    appliedGracePeriodDays: 0,
    penaltyPauses: [],
    cancelledAt: null,
    ...overrides,
  }
}

const ENTRY = { patientId: PATIENT_ID, description: 'x', status: 'pending' }

/** The single pre-transaction join recordPayment issues via `db.select`. */
function queuePrepareRows() {
  dbMock.select.mockReturnValueOnce(
    chain([{ financialEntryId: ENTRY_ID, patientId: PATIENT_ID, phone: null, email: null, fullName: null }]),
  )
}

describe('recordPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(PREREQUISITES)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('propagates the audit failure', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
    tx.insert.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))
    tx.insert.mockImplementationOnce(() => chain(Promise.reject(new Error('audit down')))) // auditLogs

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 790.75,
        paymentMethod: 'pix',
        paidAt: '2026-09-03T00:00:00.000Z',
        expectedTotalDue: 790.75,
      }),
    ).rejects.toThrow('audit down')

    // The callback threw, so withTransaction rolls the payment back with it,
    // and nothing runs after the commit.
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(claimAndSendPendingEventMock).not.toHaveBeenCalled()
  })

  it('790.75 against 750 due 2026-05-22, no priors, pays it off exactly', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails: entry still pending

    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
    tx.insert.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))

    const auditInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, auditInsert)) // auditLogs
    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 790.75,
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
      expectedTotalDue: 790.75,
    })

    expect(result.allocation).toEqual({
      interestCovered: 25.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 0,
    })
    expect(result.installmentPaid).toBe(true)
    // The audit row is written on the same transaction as the payment, so a
    // failed audit insert rolls the payment back instead of leaving it
    // recorded behind a 500.
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(auditInsert.value).toEqual({
      tenantId: TENANT,
      userId: USER_ID,
      action: 'update',
      entityType: 'installment',
      entityId: INSTALLMENT_ID,
      changes: {
        payment: {
          old: null,
          new: {
            amount: 790.75,
            paymentMethod: 'pix',
            requestedPaidAt: '2026-09-03T00:00:00.000Z',
            paidAt: '2026-09-03T00:00:00.000Z',
            allocation: { interestCovered: 25.75, fineCovered: 15, principalCovered: 750, excessAmount: 0 },
          },
        },
      },
      ipAddress: undefined,
      userAgent: undefined,
    })
  })

  // allocatePayment caps at the real total due (790.75); the rest is recorded
  // as excess and never reaches the stored allocation.
  it.each([
    { amount: 790.76, excessAmount: 0.01, stored: '790.76' },
    { amount: 900, excessAmount: 109.25, stored: '900.00' },
  ])(
    'a confirmed overpayment of $amount is recorded in full, allocated 790.75, and settles the installment',
    async ({ amount, excessAmount, stored }) => {
      const now = new Date('2026-09-05T10:00:00.000Z')
      vi.useFakeTimers()
      vi.setSystemTime(now)

      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
      tx.select.mockReturnValueOnce(chain([])) // live payments, no priors

      const paymentInsert: { value?: unknown } = {}
      tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
      const cashInsert: { value?: unknown } = {}
      tx.insert.mockReturnValueOnce(chainCapturing(undefined, cashInsert))

      const installmentUpdate: { value?: unknown } = {}
      tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
      tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
      tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

      tx.insert.mockReturnValueOnce(chain(undefined)) // auditLogs
      const result = await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount,
        paymentMethod: 'pix',
        paidAt: '2026-09-03T00:00:00.000Z',
        expectedTotalDue: 790.75,
        acceptOverpayment: true,
      })

      expect(result.allocation).toEqual({
        interestCovered: 25.75,
        fineCovered: 15,
        principalCovered: 750,
        excessAmount,
      })
      expect(result.installmentPaid).toBe(true)
      expect(paymentInsert.value).toMatchObject({ amount: stored, recordedAt: now })
      expect(cashInsert.value).toMatchObject({ amount: stored })
      expect(installmentUpdate.value).toMatchObject({ status: 'paid', amountPaid: '750.00' })
    },
  )

  it('refuses an overpayment the operator did not confirm, before any write', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 900,
        paymentMethod: 'pix',
        paidAt: '2026-09-03T00:00:00.000Z',
        expectedTotalDue: 790.75,
      }),
    ).rejects.toMatchObject({ code: 'OVERPAYMENT_NOT_CONFIRMED' })

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('refuses a payment dated before an existing one and names the installment and the later date', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          amount: '500.00',
          interestCovered: '17.75',
          fineCovered: '15.00',
          principalCovered: '467.25',
          paymentMethod: 'cash',
          paidAt: '2026-08-01T15:00:00.000Z',
          recordedAt: '2026-08-01T15:00:00.000Z',
        },
      ]),
    )
    tx.select.mockReturnValueOnce(chain([{ description: 'Botox', patientName: 'Maria Silva' }]))

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 50,
        paymentMethod: 'pix',
        paidAt: '2026-06-22T12:00:00.000Z',
        expectedTotalDue: 772.75,
      }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_BEFORE_LATER_PAYMENT',
      message:
        'Já existe um pagamento em 01/08/2026 na parcela 1 de Botox (Maria Silva). Registre pagamentos a partir dessa data.',
    })

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'paid', code: 'INSTALLMENT_ALREADY_PAID' },
    { status: 'cancelled', code: 'INSTALLMENT_CANCELLED' },
  ])('status $status throws $code', async ({ status, code }) => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()
    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow({ status })])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 1,
        paymentMethod: 'pix',
        expectedTotalDue: 750,
      }),
    ).rejects.toMatchObject({ code })
  })

  it('throws QUOTE_CHANGED one cent off, before the payment writes', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 790.74,
        paymentMethod: 'pix',
        paidAt: '2026-09-03T00:00:00.000Z',
        expectedTotalDue: 790.74,
      }),
    ).rejects.toMatchObject({
      code: 'QUOTE_CHANGED',
      message: 'O total pendente mudou desde que a tela foi aberta. Confira o novo valor e confirme novamente.',
    })

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('recordPayment on an entry out of collection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(PREREQUISITES)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  // The installment was paid, its payment reversed, and now paid again: the
  // renegotiation that replaced the entry still stands.
  it('repaying a reversed installment of a renegotiated entry leaves the entry renegotiated and sends no Purchase', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ ...ENTRY, status: 'renegotiated' }])) // entry lock
    tx.select.mockReturnValueOnce(chain([])) // live payments: the earlier one is reversed
    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }])) // payment record
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate))
    // A recompute would read the installments here and then write the entry.
    const entryUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, entryUpdate))
    tx.select.mockReturnValueOnce(chain([{ status: 'renegotiated', totalAmount: '750.00' }])) // meta gate
    tx.insert.mockReturnValue(chain(undefined)) // audit log

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 750,
      paymentMethod: 'pix',
      paidAt: '2026-05-20T15:00:00.000Z',
      expectedTotalDue: 750,
    })

    expect(result.installmentPaid).toBe(true)
    expect(installmentUpdate.value).toMatchObject({ status: 'paid', amountPaid: '750.00' })
    expect(entryUpdate.value).toBeUndefined()
    expect(enqueueMetaEventMock).not.toHaveBeenCalled()
  })
})

describe('recordPayment on an installment with legacy payment splits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(PREREQUISITES)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  // p1 was stored as all principal by code that predates the engine. Replayed,
  // Jun 22 is 31 days late: interest 7.75, fine 15, principal 77.25.
  it('rewrites the stored split of an earlier payment to the replay and lists the change in the audit row', async () => {
    const { recordPayment } = await import('../financial')
    const { paymentRecords, auditLogs } = await import('@/db/schema')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    const splitUpdates: { value?: unknown; where?: unknown }[] = []
    tx.update.mockImplementation((table: unknown) => {
      const capture: { value?: unknown } = {}
      if (table === paymentRecords) splitUpdates.push(capture)
      return chainCapturing(undefined, capture)
    })
    const audit: { value?: unknown } = {}
    tx.insert.mockImplementation((table: unknown) =>
      table === auditLogs ? chainCapturing(undefined, audit) : chain([{ id: 'pay-new' }]),
    )

    tx.select.mockReturnValueOnce(chain([lockedInstallmentRow()])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ ...ENTRY, status: 'partial' }])) // entry lock
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          amount: '100.00',
          interestCovered: '0.00',
          fineCovered: '0.00',
          principalCovered: '100.00',
          paymentMethod: 'cash',
          paidAt: '2026-06-22T12:00:00.000Z',
          recordedAt: '2026-06-22T12:00:00.000Z',
        },
      ]),
    ) // live payments
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '127.25' }])) // siblings
    tx.select.mockReturnValueOnce(chain([{ status: 'partial', totalAmount: '750.00' }])) // meta gate
    tx.select.mockReturnValue(chain([]))

    // 672.75 left from Jun 22 to Jul 22, 30 days: 6.73 interest.
    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 50,
      paymentMethod: 'pix',
      paidAt: '2026-07-22T12:00:00.000Z',
      expectedTotalDue: 679.48,
    })

    expect(splitUpdates.map((u) => u.value)).toEqual([
      { interestCovered: '7.75', fineCovered: '15.00', principalCovered: '77.25' },
    ])
    expect(audit.value).toMatchObject({
      changes: {
        paymentSplits: {
          old: [{ id: 'p1', interestCovered: 0, fineCovered: 0, principalCovered: 100 }],
          new: [{ id: 'p1', interestCovered: 7.75, fineCovered: 15, principalCovered: 77.25 }],
        },
      },
    })
  })
})

describe('recordPayment locking and audit', () => {
  // Not yet due, so no fine or interest: p1 left 650 to pay.
  const P1 = {
    id: 'p1',
    installmentId: INSTALLMENT_ID,
    amount: '100.00',
    interestCovered: '0.00',
    fineCovered: '0.00',
    principalCovered: '100.00',
    paymentMethod: 'cash',
    paidAt: '2026-08-01T15:00:00.000Z',
    recordedAt: '2026-08-01T15:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(PREREQUISITES)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  async function pay(paidAt: string) {
    const { recordPayment } = await import('../financial')
    const { financialEntries, installments, paymentRecords } = await import('@/db/schema')
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'insert') return table === paymentRecords ? [{ id: 'pay-new' }] : undefined
      if (q.op !== 'select') return undefined
      if (table === paymentRecords) return [P1]
      if (table === installments) {
        const fields = Object.keys((q.fields as object | undefined) ?? {})
        if (fields.includes('amountPaid')) return [{ status: 'pending', amountPaid: '150.00' }]
        return [lockedInstallmentRow({ dueDate: '2026-09-30' })]
      }
      if (table === financialEntries) return [{ patientId: PATIENT_ID, description: 'x', status: 'partial', totalAmount: '750.00' }]
      return []
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()
    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 50,
      paymentMethod: 'pix',
      paidAt,
      expectedTotalDue: 650,
    })
    return { log, financialEntries, installments, paymentRecords }
  }

  it('locks the entry after the installment and before the entry status is recomputed', async () => {
    const { log, installments, financialEntries } = await pay('2026-08-02T12:00:00.000Z')

    const entryLock = log.findIndex((q) => isLock(q) && tableOf(q) === financialEntries)
    const installmentLock = log.findIndex((q) => isLock(q) && tableOf(q) === installments)
    const siblingsRead = log.findIndex(
      (q) => q.op === 'select' && tableOf(q) === installments && Object.keys((q.fields as object | undefined) ?? {}).includes('amountPaid'),
    )
    expect(entryLock).toBeGreaterThan(-1)
    expect(installmentLock).toBeLessThan(entryLock)
    expect(entryLock).toBeLessThan(siblingsRead)
  })

  // Earlier on p1's own BR day: the payment moves to p1's instant and replays
  // after it.
  it('records a payment dated earlier on the latest payment\'s BR day at that payment\'s instant, and audits both dates', async () => {
    const { log, paymentRecords } = await pay('2026-08-01T12:00:00.000Z')
    const { auditLogs } = await import('@/db/schema')

    const paymentInsert = log.find((q) => q.op === 'insert' && tableOf(q) === paymentRecords)
    expect(paymentInsert?.capture.value).toMatchObject({ paidAt: new Date('2026-08-01T15:00:00.000Z') })
    const audit = log.find((q) => q.op === 'insert' && tableOf(q) === auditLogs)
    expect(audit?.capture.value).toMatchObject({
      changes: {
        payment: {
          new: { requestedPaidAt: '2026-08-01T12:00:00.000Z', paidAt: '2026-08-01T15:00:00.000Z' },
        },
      },
    })
  })
})

describe('recordPayment by card', () => {
  const TERMINAL_ID = '00000000-0000-0000-0000-00000000t001'
  const CARD_PAYMENT_ID = '00000000-0000-0000-0000-00000000c001'

  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(null)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
    createCardPaymentTxMock.mockResolvedValue({ cardPaymentId: CARD_PAYMENT_ID })
  })

  // Regression: the cash inflow at swipe time overstates cash by the fee and
  // dates it on the sale day instead of the repasse dates.
  it('credit 6x opens a card payment for the gross amount, links the record to it and writes no cash inflow', async () => {
    const { recordPayment } = await import('../financial')
    const { cashMovements, paymentRecords, installments, financialEntries } = await import('@/db/schema')
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'insert' && table === paymentRecords) return [{ id: 'pay-1' }]
      if (q.op !== 'select') return undefined
      if (table === installments) {
        if (isLock(q)) return [lockedInstallmentRow({ amount: '3000.00' })]
        return [{ status: 'pending', amountPaid: '0' }]
      }
      if (table === financialEntries) return isLock(q) ? [ENTRY] : [{ status: 'pending', totalAmount: '3000.00' }]
      return []
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 3000,
      paymentMethod: 'credit_card',
      card: { terminalId: TERMINAL_ID, installmentCount: 6, expectedRate: 8.99 },
      paidAt: '2026-05-22T15:00:00.000Z',
      expectedTotalDue: 3000,
    })

    expect(createCardPaymentTxMock).toHaveBeenCalledWith(
      tx,
      TENANT,
      USER_ID,
      expect.objectContaining({
        terminalId: TERMINAL_ID,
        method: 'credit_card',
        installmentCount: 6,
        expectedRate: 8.99,
        gross: 3000,
        patientId: PATIENT_ID,
        description: 'x',
        paidAt: new Date('2026-05-22T15:00:00.000Z'),
      }),
    )
    const link = log.find((q) => q.op === 'update' && tableOf(q) === paymentRecords && q.capture.value && 'cardPaymentId' in (q.capture.value as object))
    expect(link?.capture.value).toEqual({ cardPaymentId: CARD_PAYMENT_ID })
    expect(log.some((q) => q.op === 'insert' && tableOf(q) === cashMovements)).toBe(false)
  })

  it('pix still writes the cash inflow and opens no card payment', async () => {
    const { recordPayment } = await import('../financial')
    const { cashMovements, paymentRecords, installments, financialEntries } = await import('@/db/schema')
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'insert' && table === paymentRecords) return [{ id: 'pay-1' }]
      if (q.op !== 'select') return undefined
      if (table === installments) {
        return isLock(q) ? [lockedInstallmentRow({ amount: '3000.00' })] : [{ status: 'pending', amountPaid: '0' }]
      }
      if (table === financialEntries) return isLock(q) ? [ENTRY] : [{ status: 'pending', totalAmount: '3000.00' }]
      return []
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 3000,
      paymentMethod: 'pix',
      paidAt: '2026-05-22T15:00:00.000Z',
      expectedTotalDue: 3000,
    })

    expect(createCardPaymentTxMock).not.toHaveBeenCalled()
    expect(log.some((q) => q.op === 'insert' && tableOf(q) === cashMovements)).toBe(true)
  })
})

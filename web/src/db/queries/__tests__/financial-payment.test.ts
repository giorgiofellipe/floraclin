import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, copied from
// financial-meta.test.ts. Every method call returns the same proxy so any
// chain shape resolves to `result` when awaited.
function chain(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
        }
        return () => proxy
      },
    },
  )
  return proxy
}

// Like chain(), but also records the payload passed to .set() or .values(),
// so a test can assert on the write itself and not just that a write
// happened. chain() alone discards chained-call arguments, which is not
// enough to check what recordPayment actually persists.
function chainCapturing(result: unknown, capture: { value?: unknown }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
        }
        if (prop === 'set' || prop === 'values') {
          return (payload: unknown) => {
            capture.value = payload
            return proxy
          }
        }
        return () => proxy
      },
    },
  )
  return proxy
}

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
    execute: vi.fn(),
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

// Raw SQL FOR UPDATE lock result: snake_case.
function lockedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    installment_number: 1,
    status: 'pending',
    amount: '750.00',
    amount_paid: '0',
    fine_amount: '0',
    due_date: DUE_DATE,
    financial_entry_id: ENTRY_ID,
    applied_fine_type: 'percentage',
    applied_fine_value: '2.00',
    applied_interest_rate: '1.00',
    applied_grace_period_days: 0,
    penalty_pauses: [],
    cancelled_at: null,
    last_fine_interest_calc_at: null,
    ...overrides,
  }
}


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

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
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

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
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

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([])) // live payments, no priors

      const paymentInsert: { value?: unknown } = {}
      tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
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

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
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

  it('a backdated partial payment persists interest as of now, not as of the payment date', async () => {
    const now = new Date('2026-09-10T14:04:50.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([])) // live payments, no priors

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-new' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'partial', amountPaid: '77.25' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    tx.insert.mockReturnValueOnce(chain(undefined)) // auditLogs
    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 100,
      paymentMethod: 'pix',
      paidAt: '2026-06-22T12:00:00.000Z',
      expectedTotalDue: 772.75,
    })

    // Jun 22 is 31 days overdue: fine 15, interest 7.75, principal covered
    // 77.25. Sep 10 is 80 days later on 672.75: 17.94. Priced as of Jun 22 it
    // would be 0.
    expect(installmentUpdate.value).toMatchObject({
      interestAmount: '17.94',
      lastFineInterestCalcAt: new Date('2026-06-22T12:00:00.000Z'),
    })
    expect(paymentInsert.value).toMatchObject({ recordedAt: now })
  })

  it('refuses a payment dated before an existing one and names the installment and the later date', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
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
    tx.execute.mockResolvedValueOnce([lockedInstallmentRow({ status })])

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

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
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

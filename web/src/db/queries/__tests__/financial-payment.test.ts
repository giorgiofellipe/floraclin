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

// Raw SQL FOR UPDATE lock result: snake_case, already fine/interest-snapshotted
// so recordPayment skips the settings-snapshot branch (fewer calls to mock).
function lockedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    status: 'pending',
    amount: '750.00',
    amount_paid: '0',
    fine_amount: '0',
    due_date: DUE_DATE,
    financial_entry_id: ENTRY_ID,
    applied_fine_type: 'percentage',
    applied_fine_value: '2.00',
    applied_interest_rate: '1.00',
    last_fine_interest_calc_at: null,
    ...overrides,
  }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
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

  it('790.75 against 750 due 2026-05-22, no priors, pays it off exactly', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails: entry still pending

    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
    tx.insert.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 790.75,
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    } as never)

    expect(result.allocation).toEqual({
      interestCovered: 25.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 0,
    })
    expect(result.installmentPaid).toBe(true)
  })

  it('790.77 is accepted, recorded at 790.77, and allocated 790.75 with 0.02 excess', async () => {
    const now = new Date('2026-09-05T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    const cashInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, cashInsert))
    tx.update.mockReturnValueOnce(chain(undefined)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 790.77,
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    } as never)

    expect(result.allocation).toEqual({
      interestCovered: 25.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 0.02,
    })
    expect(result.installmentPaid).toBe(true)
    expect(paymentInsert.value).toMatchObject({ amount: '790.77', recordedAt: now })
    expect(cashInsert.value).toMatchObject({ amount: '790.77' })
  })

  it('790.76 is recorded at 790.76, allocated 790.75 with 0.01 excess', async () => {
    const now = new Date('2026-09-05T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([]))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }]))
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }]))

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.insert.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))
    tx.update.mockReturnValueOnce(chain(undefined))

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 790.76,
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    } as never)

    // allocatePayment caps at the real total due (790.75); the extra 0.01 is
    // recorded as excessAmount and never reaches the stored allocation.
    expect(result.allocation).toEqual({
      interestCovered: 25.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 0.01,
    })
    expect(result.installmentPaid).toBe(true)
    expect(paymentInsert.value).toMatchObject({ amount: '790.76', recordedAt: now })
  })

  it('an overpayment still marks the installment paid', async () => {
    const now = new Date('2026-09-05T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 900,
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    } as never)

    expect(result.allocation).toEqual({
      interestCovered: 25.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 109.25,
    })
    expect(result.installmentPaid).toBe(true)
    expect(paymentInsert.value).toMatchObject({ amount: '900.00' })
    expect(installmentUpdate.value).toMatchObject({ status: 'paid', amountPaid: '750.00' })
  })

  // AR2-1: the persisted state prices the trailing balance as of now, not as
  // of the backdated payment. Against the v1 bug (asOf = paidAt) this would
  // store interestAmount '0.00', because June 22 is the payment's own date
  // and nothing is left overdue from its own point of view.
  it('a backdated partial payment persists interest as of now, not as of the payment date', async () => {
    const now = new Date('2026-09-10T14:04:50.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p-aug',
          amount: '100.00',
          paidAt: '2026-08-01T12:00:00.000Z',
          recordedAt: '2026-08-01T12:00:00.000Z',
        },
      ]),
    ) // existingPayments

    tx.update.mockReturnValueOnce(chain(undefined)) // rewrite of p-aug

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-new' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'partial', amountPaid: '200.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 100,
      paymentMethod: 'pix',
      paidAt: '2026-06-22T12:00:00.000Z',
    } as never)

    // Jun 22 is 31 days overdue: fine 15, interest 7.75, principal covered
    // 77.25. Aug 1 is 40 days later on 672.75: interest 8.97, principal
    // covered 91.03. Sep 10 is 40 more days on 581.72: 7.7563, rounds to 7.76.
    expect(installmentUpdate.value).toMatchObject({
      interestAmount: '7.76',
      lastFineInterestCalcAt: new Date('2026-08-01T12:00:00.000Z'),
    })
    expect(paymentInsert.value).toMatchObject({ recordedAt: now })
  })

  // AR2-skep4: the installment's paidAt/paymentMethod belong to whichever
  // payment completed it in replay order, not to the new one. Here the June
  // payment only brings the balance closer; the existing August payment is
  // what settles it once replayed after it.
  it('a backdated payment that is completed by a later existing payment stamps the later payment\'s date and method', async () => {
    const now = new Date('2026-09-10T14:04:50.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p-aug',
          amount: '700.00',
          paidAt: '2026-08-01T12:00:00.000Z',
          recordedAt: '2026-08-01T12:00:00.000Z',
          paymentMethod: 'pix',
        },
      ]),
    ) // existingPayments

    tx.update.mockReturnValueOnce(chain(undefined)) // rewrite of p-aug

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-new' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 109,
      paymentMethod: 'cash',
      paidAt: '2026-06-22T12:00:00.000Z',
    } as never)

    expect(installmentUpdate.value).toMatchObject({
      status: 'paid',
      paidAt: new Date('2026-08-01T12:00:00.000Z'),
      paymentMethod: 'pix',
    })
  })

  // Art. 354 allocates each payment against the balance standing at its own
  // date, so inserting one re-splits the payments around it.
  //
  // The allocation rewrite also held under the old isBackdated branch. What
  // this test pins is the settlement metadata at the end: the payment that
  // completed the debt, not the last one replayed. AR-1 itself, that a quote
  // counts only payments at or before asOf, is pinned in penalties.test.ts.
  it('a payment dated before an existing one rewrites the existing record allocation', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          amount: '500.00',
          paymentMethod: 'cash',
          paidAt: '2026-08-01T12:00:00.000Z',
          recordedAt: '2026-08-01T12:00:00.000Z',
        },
      ]),
    )

    // The new payment (June 22) sorts before the existing one (Aug 1), so the
    // replay re-splits p1: the new payment already exhausts the principal,
    // leaving p1 with nothing left to cover.
    const rewrite: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, rewrite))

    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-new' }]))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    const finalUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, finalUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 772.75,
      paymentMethod: 'pix',
      paidAt: '2026-06-22T12:00:00.000Z',
    } as never)

    expect(result.allocation).toEqual({
      interestCovered: 7.75,
      fineCovered: 15,
      principalCovered: 750,
      excessAmount: 0,
    })
    expect(result.installmentPaid).toBe(true)
    expect(rewrite.value).toEqual({
      interestCovered: '0.00',
      fineCovered: '0.00',
      principalCovered: '0.00',
    })
    // The June payment is what settled the debt; the August one allocated
    // nothing after the replay. Taking the last replayed payment instead
    // stamped the installment paid in August by cash.
    expect(finalUpdate.value).toMatchObject({
      status: 'paid',
      paidAt: new Date('2026-06-22T12:00:00.000Z'),
      paymentMethod: 'pix',
    })
  })

  // AR-exec / step 3: reversed payments must not feed the replay. The
  // `isNull(paymentRecords.reversedAt)` clause on the existingPayments query
  // (financial.ts) is what keeps a reversed record out of what this select
  // returns; the generic chain() proxy discards .where() arguments, so
  // exercising the SQL predicate itself is impractical against this mock
  // harness. This test instead pins the arithmetic to what only the live
  // record (never a reversed one) would produce, mirroring what Postgres
  // hands back once that clause is applied.
  it('a reversed payment record is excluded: amountPaid reflects only the live record', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    // Only the live record comes back: a reversed sibling never reaches here.
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p-live',
          amount: '100.00',
          paidAt: '2026-06-01T12:00:00.000Z',
          recordedAt: '2026-06-01T12:00:00.000Z',
        },
      ]),
    )

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chain(undefined)) // rewrite of p-live
    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-new' }]))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'partial', amountPaid: '125.82' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 50,
      paymentMethod: 'pix',
      paidAt: '2026-07-01T12:00:00.000Z',
    } as never)

    // 82.5 of principal from the live payment plus 43.32 from this one: had a
    // reversed payment leaked into the replay, amountPaid would be higher.
    expect(result.allocation).toEqual({
      interestCovered: 6.68,
      fineCovered: 0,
      principalCovered: 43.32,
      excessAmount: 0,
    })
    expect(installmentUpdate.value).toMatchObject({ amountPaid: '125.82' })
    expect(result.installmentPaid).toBe(false)
  })

  it('status paid throws INSTALLMENT_ALREADY_PAID', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()
    tx.execute.mockResolvedValueOnce([lockedInstallmentRow({ status: 'paid' })])

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 1,
        paymentMethod: 'pix',
      } as never),
    ).rejects.toMatchObject({ code: 'INSTALLMENT_ALREADY_PAID' })
  })

  it('status cancelled throws INSTALLMENT_CANCELLED', async () => {
    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()
    tx.execute.mockResolvedValueOnce([lockedInstallmentRow({ status: 'cancelled' })])

    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 1,
        paymentMethod: 'pix',
      } as never),
    ).rejects.toMatchObject({ code: 'INSTALLMENT_CANCELLED' })
  })

  // Interest a payment does not cover stays owed.
  //
  // The old normal branch stored the same 24 by subtracting what the payment
  // covered, so this passes against the pre-branch code as well. AR-2 proper,
  // that replay itself carries the remainder forward rather than forgiving it,
  // is pinned in penalties.test.ts.
  it('a payment of 1 against 25 of accrued interest carries the uncovered 24, not 0', async () => {
    const paidAt = '2026-08-30T03:00:00.000Z' // exactly 100 days overdue: interest = 25.00
    vi.useFakeTimers()
    vi.setSystemTime(new Date(paidAt))

    const { recordPayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([])) // no priors

    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const result = await recordPayment(TENANT, USER_ID, {
      installmentId: INSTALLMENT_ID,
      amount: 1,
      paymentMethod: 'pix',
      paidAt,
    } as never)

    expect(result.allocation).toEqual({
      interestCovered: 1,
      fineCovered: 0,
      principalCovered: 0,
      excessAmount: 0,
    })
    expect(installmentUpdate.value).toMatchObject({ interestAmount: '24.00' })
  })

  describe('Purchase event 7-day attribution window', () => {
    const NOW = new Date('2026-09-10T12:00:00.000Z')

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
    })

    function mockThroughGate1(tx: ReturnType<typeof makeTx>, paidAt: string) {
      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([])) // no priors
      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
      tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
      tx.update.mockReturnValueOnce(chain(undefined)) // installments final
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '1.00' }])) // updateEntryStatus
      tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', totalAmount: '750.00' }])) // meta gate 1 passes
      return paidAt
    }

    it('does not enqueue a Purchase when paidAt is older than 7 days', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      const paidAt = mockThroughGate1(tx, '2026-09-02T12:00:00.000Z') // 8 days before NOW
      tx.select.mockReturnValueOnce(chain([])) // meta gate 2: not renegotiated
      // No further select is queued: the staleness gate returns null before
      // the outbox re-read, and enqueueMetaEvent is never reached.

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 1,
        paymentMethod: 'pix',
        paidAt,
      } as never)

      expect(enqueueMetaEventMock).not.toHaveBeenCalled()
    })

    it('does enqueue a Purchase when paidAt is within the last 7 days', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      const paidAt = mockThroughGate1(tx, '2026-09-09T12:00:00.000Z') // 1 day before NOW
      tx.select.mockReturnValueOnce(chain([])) // meta gate 2: not renegotiated
      tx.select.mockReturnValueOnce(
        chain([
          {
            id: 'outbox-1',
            prospectId: null,
            patientId: PATIENT_ID,
            eventId: `purchase:${ENTRY_ID}`,
            eventTime: new Date(paidAt),
            value: '750.00',
            payload: null,
            status: 'pending',
          },
        ]),
      ) // outbox re-read

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 1,
        paymentMethod: 'pix',
        paidAt,
      } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
    })
  })
})

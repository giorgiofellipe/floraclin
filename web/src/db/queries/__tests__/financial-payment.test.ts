import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { quoteInstallment, replayPayments, type InstallmentBase } from '@/lib/financial/penalties'

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

/** The same fixture as `lockedInstallmentRow`, in the shape the engine takes. */
const BASE: InstallmentBase = {
  amount: 750,
  dueDate: DUE_DATE,
  appliedFineValue: 2,
  appliedFineType: 'percentage',
  appliedInterestRate: 1,
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
  // of the backdated payment. Had the replay been given paidAt as asOf, this
  // would store '0.00', because nothing is overdue from June 22's own point
  // of view. The 7.76 also held before this round, since the old engine read
  // the wall clock and the frozen clock equals the now captured here; what
  // this test newly pins is the recordedAt written on the payment row.
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

    // The August payment has to fit the balance exactly once the June payment
    // sorts ahead of it: anything above that is refused as an overfill.
    const june = { amount: 109, paidAt: '2026-06-22T12:00:00.000Z', recordedAt: now.toISOString() }
    const augPaidAt = '2026-08-01T12:00:00.000Z'
    const augAmount = quoteInstallment(BASE, [june], new Date(augPaidAt)).totalDue
    expect(augAmount).toBe(672.6)
    const aug = { id: 'p-aug', amount: augAmount, paidAt: augPaidAt, recordedAt: augPaidAt }
    const augAllocation = replayPayments(BASE, [june, aug], now).payments.find((p) => p.id === 'p-aug')!
    expect(augAllocation.excessAmount).toBe(0)

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
          amount: augAmount.toFixed(2),
          interestCovered: augAllocation.interestCovered.toFixed(2),
          fineCovered: augAllocation.fineCovered.toFixed(2),
          principalCovered: augAllocation.principalCovered.toFixed(2),
          paidAt: augPaidAt,
          recordedAt: augPaidAt,
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
      amount: june.amount,
      paymentMethod: 'cash',
      paidAt: june.paidAt,
    } as never)

    expect(installmentUpdate.value).toMatchObject({
      status: 'paid',
      paidAt: new Date(augPaidAt),
      paymentMethod: 'pix',
    })
  })

  // Art. 354 re-splits every payment against the balance standing at its own
  // date, so a payment inserted ahead of an existing one can take that
  // payment's whole debt away. That is the case the guard refuses; the
  // exact-fit case above is the one it lets through.
  it('a payment dated before an existing one is refused when it would leave that payment covering nothing', async () => {
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
          interestCovered: '10.00',
          fineCovered: '15.00',
          principalCovered: '475.00',
          paymentMethod: 'cash',
          paidAt: '2026-08-01T12:00:00.000Z',
          recordedAt: '2026-08-01T12:00:00.000Z',
        },
      ]),
    )

    // The June payment settles the installment on its own, so replayed ahead
    // of p1 it would leave p1's R$500 with nothing to cover.
    await expect(
      recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 772.75,
        paymentMethod: 'pix',
        paidAt: '2026-06-22T12:00:00.000Z',
      } as never),
    ).rejects.toMatchObject({ code: 'BACKDATED_PAYMENT_OVERFILLS' })

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
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
})

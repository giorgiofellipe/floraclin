import { describe, it, expect, vi, beforeEach } from 'vitest'
import { quoteInstallment } from '@/lib/financial/penalties'

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
// copied from financial-payment.test.ts, so a test can assert on the write
// itself rather than just that a write happened.
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

// Fixture unless a test says otherwise: R$750, due 2026-05-22, no prior
// payments, fine 2% percentage, interest 1%/month, grace 0. Matches BASE in
// penalties.test.ts so the hand-computed figures below line up with it.
const DUE_DATE = '2026-05-22'
const BASE = {
  amount: 750,
  dueDate: DUE_DATE,
  appliedFineValue: 2,
  appliedFineType: 'percentage',
  appliedInterestRate: 1,
  gracePeriodDays: 0,
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

// Typed drizzle select row used inside bulkPayInstallments' loop: camelCase,
// already fine/interest-snapshotted so the settings-snapshot branch is
// skipped (fewer calls to mock).
function typedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    status: 'pending',
    amount: '750.00',
    amountPaid: '0',
    fineAmount: '0',
    dueDate: DUE_DATE,
    financialEntryId: ENTRY_ID,
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    lastFineInterestCalcAt: null,
    ...overrides,
  }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

/** The single pre-transaction join bulkPayInstallments issues via `db.select`. */
function queuePrepareRows() {
  dbMock.select.mockReturnValueOnce(
    chain([{ financialEntryId: ENTRY_ID, patientId: PATIENT_ID, phone: null, email: null, fullName: null }]),
  )
}

describe('bulkPayInstallments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(null)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  it('charges a single unpaid overdue installment exactly quoteInstallment(base, [], paidAt).totalDue', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    const paidAt = '2026-09-03T00:00:00.000Z'
    // 2026-09-03T00:00:00Z is 21:00 BRT on September 2, so in BR calendar days
    // the installment is 103 days past its May 22 due date.
    // fine = 750 * 2% = 15. interest = 750 * 1%/30 * 103 = 25.75.
    // totalDue = 750 + 15 + 25.75 = 790.75.
    const expected = quoteInstallment(BASE, [], new Date(paidAt))
    expect(expected.totalDue).toBe(790.75)

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID }]) // FOR UPDATE lock
    tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays, before the loop
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    tx.update.mockReturnValueOnce(chain(undefined)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '790.75' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '790.75' }])) // meta gate 1 fails

    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    expect(results).toHaveLength(1)
    expect(results[0].allocation).toEqual({ interestCovered: 25.75, fineCovered: 15, principalCovered: 750 })
    expect(paymentInsert.value).toMatchObject({ amount: '790.75', recordedAt: expect.any(Date) })
  })

  // AR-5: bulkPayInstallments must not become a second pricer. A prior
  // payment (recorded through recordPayment) exactly covered the fine and
  // interest standing at its own date but touched no principal, so the
  // installment row is left with fineAmount=0, amountPaid=0. The old ad-hoc
  // block read those two zeros as "never charged" and billed the fine again;
  // quoteInstallment replays the prior payment and knows fineApplied is
  // already true.
  it('does not charge the fine a second time after a prior payment covered it without touching principal', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    // Prior payment: 2026-06-22T12:00Z, 31 days overdue.
    // fine = 750 * 2% = 15. interest = 750 * 1%/30 * 31 = 7.75.
    // Prior payment of exactly 22.75 covers interest (7.75) then fine (15),
    // leaving principalCovered = 0.
    const priorPaidAt = '2026-06-22T12:00:00.000Z'
    const priorAmount = '22.75'

    // Bulk pay 30 days later, 2026-07-22T12:00Z (June22 -> July22 is exactly
    // 30 days at the same wall-clock time, so no floor adjustment).
    // fineApplied carries over from the prior payment's replay, so no new
    // fine. interest = 750 * 1%/30 * 30 = 7.5. totalDue = 750 + 0 + 7.5 = 757.5.
    const paidAt = '2026-07-22T12:00:00.000Z'
    const expected = quoteInstallment(
      BASE,
      [{ id: 'p1', amount: 22.75, paidAt: priorPaidAt, recordedAt: priorPaidAt }],
      new Date(paidAt),
    )
    expect(expected.fineAmount).toBe(0)
    expect(expected.totalDue).toBe(757.5)

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID }])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(
      chain([{ id: 'p1', amount: priorAmount, paidAt: priorPaidAt, recordedAt: priorPaidAt }]),
    ) // existingPayments

    tx.update.mockReturnValueOnce(chain(undefined)) // rewrite of p1 (unchanged allocation)

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    expect(results[0].allocation).toEqual({ interestCovered: 7.5, fineCovered: 0, principalCovered: 750 })
    expect(paymentInsert.value).toMatchObject({ amount: '757.50', recordedAt: expect.any(Date) })
    expect(installmentUpdate.value).toMatchObject({ fineAmount: '0.00', amountPaid: '750.00', status: 'paid' })
  })

  // A bulk payment backdated before an existing payment re-splits it: Art.
  // 354 allocates each payment against the balance standing at its own date,
  // and the sentinel now sorts first.
  it('a backdated bulk payment rewrites a later existing record allocation', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    const laterPaidAt = '2026-08-01T12:00:00.000Z'
    const laterAmount = '500.00'
    const paidAt = '2026-06-22T12:00:00.000Z' // sorts before the Aug 1 record

    // Matches quoteInstallment's own "ignores payments dated after the quote
    // instant" fixture: 31 days overdue at June 22, fine 15, interest 7.75,
    // totalDue 772.75. The June-22 sentinel then exhausts the installment
    // (750 + 15 + 7.75 = 772.75), so the Aug-1 payment has nothing left to
    // cover once replayed after it.
    const expected = quoteInstallment(
      BASE,
      [{ id: 'p2', amount: 500, paidAt: laterPaidAt, recordedAt: laterPaidAt }],
      new Date(paidAt),
    )
    expect(expected.totalDue).toBe(772.75)

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID }])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(
      chain([{ id: 'p2', amount: laterAmount, paidAt: laterPaidAt, recordedAt: laterPaidAt }]),
    ) // existingPayments

    const rewrite: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, rewrite)) // rewrite of p2

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    tx.update.mockReturnValueOnce(chain(undefined)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    expect(results[0].allocation).toEqual({ interestCovered: 7.75, fineCovered: 15, principalCovered: 750 })
    expect(paymentInsert.value).toMatchObject({ amount: '772.75', recordedAt: expect.any(Date) })
    // The Aug-1 record is left covering nothing: the June-22 sentinel already
    // exhausted the installment once replayed in chronological order.
    expect(rewrite.value).toEqual({
      interestCovered: '0.00',
      fineCovered: '0.00',
      principalCovered: '0.00',
    })
  })

  // AR-exec / step 3: a reversed payment record must not feed the replay.
  // The `isNull(paymentRecords.reversedAt)` clause on the existingPayments
  // query (financial.ts) is what keeps a reversed record out of what this
  // select returns; the generic chain() proxy discards .where() arguments, so
  // exercising the SQL predicate itself is impractical against this mock
  // harness. This test instead pins the arithmetic to what only the live
  // record (never a reversed one) would produce, mirroring what Postgres
  // hands back once that clause is applied.
  it('a reversed payment record is excluded: the charge reflects only the live record', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    // Live payment: 2026-06-01T12:00Z, 10 days overdue.
    // fine = 15. interest = 750 * 1%/30 * 10 = 2.5.
    // 100 covers interest (2.5) then fine (15), leaving 82.5 of principal.
    const livePaidAt = '2026-06-01T12:00:00.000Z'
    const liveAmount = '100.00'

    // Bulk pay 30 days later, 2026-07-01T12:00Z.
    // remainingPrincipal = 750 - 82.5 = 667.5.
    // interest = 667.5 * 1%/30 * 30 = 6.675, rounds to 6.68 (half rounds up).
    // fineApplied carries over: no second fine.
    // totalDue = 667.5 + 0 + 6.68 = 674.18.
    const paidAt = '2026-07-01T12:00:00.000Z'
    const expected = quoteInstallment(
      BASE,
      [{ id: 'p-live', amount: 100, paidAt: livePaidAt, recordedAt: livePaidAt }],
      new Date(paidAt),
    )
    expect(expected.totalDue).toBe(674.18)

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID }])
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    // Only the live record comes back: a reversed sibling never reaches here.
    tx.select.mockReturnValueOnce(
      chain([{ id: 'p-live', amount: liveAmount, paidAt: livePaidAt, recordedAt: livePaidAt }]),
    )

    tx.update.mockReturnValueOnce(chain(undefined)) // rewrite of p-live (unchanged allocation)

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    // 82.5 of principal from the live payment plus 667.5 from this one: had a
    // reversed payment leaked into the replay, both the interest and the
    // remaining principal would differ.
    expect(results[0].allocation).toEqual({ interestCovered: 6.68, fineCovered: 0, principalCovered: 667.5 })
    expect(paymentInsert.value).toMatchObject({ amount: '674.18', recordedAt: expect.any(Date) })
    expect(installmentUpdate.value).toMatchObject({ amountPaid: '750.00', status: 'paid' })
  })
})

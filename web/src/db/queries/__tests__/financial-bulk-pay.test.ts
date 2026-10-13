import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
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
  penaltyPauses: [],
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

// Typed drizzle select row used inside bulkPayInstallments' loop: camelCase.
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
    appliedGracePeriodDays: 0,
    penaltyPauses: [],
    cancelledAt: null,
    lastFineInterestCalcAt: null,
    ...overrides,
  }
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

  it('a failed audit insert rejects the whole batch', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID }]) // FOR UPDATE lock
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors
    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
    tx.update.mockReturnValueOnce(chain(undefined)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '790.75' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '790.75' }])) // meta gate 1 fails
    tx.insert.mockImplementationOnce(() => chain(Promise.reject(new Error('audit down')))) // auditLogs

    await expect(
      bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: [INSTALLMENT_ID],
        paymentMethod: 'pix',
        paidAt: '2026-09-03T00:00:00.000Z',
      }),
    ).rejects.toThrow('audit down')

    expect(tx.insert).toHaveBeenCalledTimes(3)
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

    const auditInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, auditInsert)) // auditLogs
    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    expect(results).toHaveLength(1)
    expect(results[0].allocation).toEqual({ interestCovered: 25.75, fineCovered: 15, principalCovered: 750 })
    expect(paymentInsert.value).toMatchObject({ amount: '790.75', recordedAt: expect.any(Date) })
    // One audit row for the whole batch, on the same transaction as the payments.
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(auditInsert.value).toMatchObject({
      tenantId: TENANT,
      userId: USER_ID,
      action: 'update',
      entityType: 'installment',
      changes: {
        bulkPay: {
          old: null,
          new: { installmentIds: [INSTALLMENT_ID], paymentMethod: 'pix', count: 1 },
        },
      },
    })
  })

  // A prior payment that covered exactly the fine and interest leaves the row
  // at fineAmount=0, amountPaid=0, which reads as "never charged".
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
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(
      chain([{ id: 'p1', amount: priorAmount, paidAt: priorPaidAt, recordedAt: priorPaidAt }]),
    ) // existingPayments

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // installments final
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails

    tx.insert.mockReturnValueOnce(chain(undefined)) // auditLogs
    const results = await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt,
    })

    expect(results[0].allocation).toEqual({ interestCovered: 7.5, fineCovered: 0, principalCovered: 750 })
    expect(paymentInsert.value).toMatchObject({ amount: '757.50', recordedAt: expect.any(Date) })
    expect(installmentUpdate.value).toMatchObject({ fineAmount: '0.00', amountPaid: '750.00', status: 'paid' })
  })

  it('refuses a batch dated before an existing payment and names the installment that blocked it', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_ID, financial_entry_id: ENTRY_ID }])
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ installmentNumber: 3 })])) // row
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p2',
          amount: '100.00',
          paidAt: '2026-08-01T15:00:00.000Z',
          recordedAt: '2026-08-01T15:00:00.000Z',
        },
      ]),
    ) // live payments
    tx.select.mockReturnValueOnce(chain([{ description: 'Botox', patientName: 'Maria Silva' }]))

    await expect(
      bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: [INSTALLMENT_ID],
        paymentMethod: 'pix',
        paidAt: '2026-06-22T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_BEFORE_LATER_PAYMENT',
      message:
        'Já existe um pagamento em 01/08/2026 na parcela 3 de Botox (Maria Silva). Registre pagamentos a partir dessa data.',
    })

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('locks the entries it writes in id order before the first write, whatever order the installments were listed in', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    const ENTRY_A = '00000000-0000-0000-0000-00000000e00a'
    const ENTRY_B = '00000000-0000-0000-0000-00000000e00b'
    const INSTALLMENT_A = '00000000-0000-0000-0000-00000000i00a'
    const INSTALLMENT_B = '00000000-0000-0000-0000-00000000i00b'
    queuePrepareRows()

    tx.execute.mockResolvedValueOnce([
      { id: INSTALLMENT_A, financial_entry_id: ENTRY_A },
      { id: INSTALLMENT_B, financial_entry_id: ENTRY_B },
    ])
    for (const [installmentId, entryId] of [
      [INSTALLMENT_B, ENTRY_B],
      [INSTALLMENT_A, ENTRY_A],
    ]) {
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: installmentId, financialEntryId: entryId })]))
      tx.select.mockReturnValueOnce(chain([])) // live payments
      tx.insert.mockReturnValueOnce(chain([{ id: `pay-${installmentId}` }]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
      tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
      tx.update.mockReturnValueOnce(chain(undefined)) // installments final
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
      tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
      tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails
    }
    tx.insert.mockReturnValueOnce(chain(undefined)) // auditLogs

    await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_B, INSTALLMENT_A],
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    })

    const entryLock = tx.execute.mock.calls
      .map(([query]) => new PgDialect().sqlToQuery(query as SQL))
      .find((q) => q.sql.includes('financial_entries'))
    expect(entryLock?.sql).toMatch(/ORDER BY id\s+FOR UPDATE/)
    expect(String(entryLock?.params)).toContain(ENTRY_A)
    expect(String(entryLock?.params)).toContain(ENTRY_B)
    expect(tx.execute.mock.invocationCallOrder[1]).toBeLessThan(tx.update.mock.invocationCallOrder[0])
  })
})

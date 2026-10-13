import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chain, chainCapturing, isLock, routedTx, selectSql, tableOf, whereParams, type Capture } from '@/tests/mocks/drizzle-tx'

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
// penalties.test.ts.
const DUE_DATE = '2026-05-22'

const ENTRY = { id: ENTRY_ID, patientId: PATIENT_ID, description: 'x', status: 'pending' }

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

// The installment row bulkPayInstallments reads inside its loop.
function typedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
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

    tx.select.mockReturnValueOnce(chain([{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID }])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors
    tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
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

  it('charges a single unpaid overdue installment its whole total due, fine and interest included', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    const paidAt = '2026-09-03T00:00:00.000Z'
    // 2026-09-03T00:00:00Z is 21:00 BRT on September 2, so in BR calendar days
    // the installment is 103 days past its May 22 due date.
    // fine = 750 * 2% = 15. interest = 750 * 1%/30 * 103 = 25.75.
    // totalDue = 750 + 15 + 25.75 = 790.75.

    tx.select.mockReturnValueOnce(chain([{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID }])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(chain([])) // existingPayments, no priors

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
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
    // One audit row per installment paid, on the same transaction as the payments.
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(auditInsert.value).toMatchObject({
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
            requestedPaidAt: paidAt,
            paidAt,
            allocation: { interestCovered: 25.75, fineCovered: 15, principalCovered: 750 },
          },
        },
        bulkPay: { old: null, new: { installmentIds: [INSTALLMENT_ID] } },
      },
    })
  })

  // A prior payment that covered exactly the fine and interest paid no
  // principal, so the row looks like it was never charged.
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

    // Bulk pay on 2026-07-22, 30 BR calendar days after Jun 22. The fine was
    // applied by the prior payment, so no new one.
    // interest = 750 * 1%/30 * 30 = 7.5. totalDue = 750 + 0 + 7.5 = 757.5.
    const paidAt = '2026-07-22T12:00:00.000Z'

    tx.select.mockReturnValueOnce(chain([{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID }])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
    tx.select.mockReturnValueOnce(chain([typedInstallmentRow()])) // row
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          amount: priorAmount,
          interestCovered: '7.75',
          fineCovered: '15.00',
          principalCovered: '0.00',
          paidAt: priorPaidAt,
          recordedAt: priorPaidAt,
        },
      ]),
    ) // existingPayments

    const paymentInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing([{ id: 'pay-1' }], paymentInsert))
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
    expect(installmentUpdate.value).toMatchObject({ amountPaid: '750.00', status: 'paid' })
  })

  it('refuses a batch dated before an existing payment and names the installment that blocked it', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    tx.select.mockReturnValueOnce(chain([{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID }])) // installment lock
    tx.select.mockReturnValueOnce(chain([ENTRY])) // entry lock
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

    tx.select.mockReturnValueOnce(
      chain([
        { id: INSTALLMENT_A, financialEntryId: ENTRY_A },
        { id: INSTALLMENT_B, financialEntryId: ENTRY_B },
      ]),
    ) // installment lock
    const entryLock: Capture = {}
    tx.select.mockReturnValueOnce(
      chain([{ ...ENTRY, id: ENTRY_A }, { ...ENTRY, id: ENTRY_B }], entryLock),
    ) // entry lock
    for (const [installmentId, entryId] of [
      [INSTALLMENT_B, ENTRY_B],
      [INSTALLMENT_A, ENTRY_A],
    ]) {
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: installmentId, financialEntryId: entryId })]))
      tx.select.mockReturnValueOnce(chain([])) // live payments
      tx.insert.mockReturnValueOnce(chain([{ id: `pay-${installmentId}` }]))
      tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
      tx.update.mockReturnValueOnce(chain(undefined)) // installments final
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus
      tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries
      tx.select.mockReturnValueOnce(chain([{ status: 'pending', totalAmount: '750.00' }])) // meta gate 1 fails
      tx.insert.mockReturnValueOnce(chain(undefined)) // auditLogs
    }

    await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_B, INSTALLMENT_A],
      paymentMethod: 'pix',
      paidAt: '2026-09-03T00:00:00.000Z',
    })

    const lock = selectSql(tx.select.mock.calls[1][0], entryLock)
    expect(lock).toMatch(/from "floraclin"\."financial_entries"[\s\S]*order by "floraclin"\."financial_entries"\."id"[\s\S]*for update/i)
    expect(whereParams(entryLock)).toEqual(expect.arrayContaining([ENTRY_A, ENTRY_B]))
    expect(tx.select.mock.invocationCallOrder[1]).toBeLessThan(tx.update.mock.invocationCallOrder[0])
  })
})

describe('bulkPayInstallments dating and audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(null)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  // Not yet due, so no fine or interest: p1 left 650 to pay. The batch is
  // dated earlier on p1's own BR day, so it moves to p1's instant.
  it('pays at the latest payment\'s instant on its BR day and audits each installment with the amount and that date', async () => {
    const { bulkPayInstallments } = await import('../financial')
    const { financialEntries, installments, paymentRecords, auditLogs } = await import('@/db/schema')
    const p1 = {
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
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'insert') return table === paymentRecords ? [{ id: 'pay-new' }] : undefined
      if (q.op !== 'select') return undefined
      if (table === paymentRecords) return [p1]
      if (table === installments) {
        if (isLock(q)) return [{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID }]
        const fields = Object.keys((q.fields as object | undefined) ?? {})
        if (fields.includes('amountPaid')) return [{ status: 'paid', amountPaid: '750.00' }]
        return [typedInstallmentRow({ dueDate: '2026-09-30', installmentNumber: 1 })]
      }
      if (table === financialEntries) return [{ id: ENTRY_ID, patientId: PATIENT_ID, description: 'x', status: 'partial', totalAmount: '750.00' }]
      return []
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    queuePrepareRows()

    await bulkPayInstallments(TENANT, USER_ID, {
      installmentIds: [INSTALLMENT_ID],
      paymentMethod: 'pix',
      paidAt: '2026-08-01T12:00:00.000Z',
    })

    const paymentInsert = log.find((q) => q.op === 'insert' && tableOf(q) === paymentRecords)
    expect(paymentInsert?.capture.value).toMatchObject({ amount: '650.00', paidAt: new Date('2026-08-01T15:00:00.000Z') })
    const audits = log.filter((q) => q.op === 'insert' && tableOf(q) === auditLogs)
    expect(audits.map((q) => q.capture.value)).toEqual([
      expect.objectContaining({
        entityType: 'installment',
        entityId: INSTALLMENT_ID,
        changes: expect.objectContaining({
          payment: { old: null, new: expect.objectContaining({ amount: 650, paidAt: '2026-08-01T15:00:00.000Z' }) },
        }),
      }),
    ])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chain, chainCapturing, isLock, routedTx, tableOf } from '@/tests/mocks/drizzle-tx'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'
const PAYMENT_RECORD_ID = '00000000-0000-0000-0000-00000000r001'

// Fixture unless a test says otherwise: R$750, due 2026-05-22, fine 2%
// percentage, interest 1%/month, grace 0. Matches BASE in penalties.test.ts.
const DUE_DATE = '2026-05-22'

function installmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    tenantId: TENANT,
    financialEntryId: ENTRY_ID,
    amount: '750.00',
    dueDate: DUE_DATE,
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    appliedGracePeriodDays: 0,
    penaltyPauses: [],
    cancelledAt: null,
    ...overrides,
  }
}


/**
 * `transaction` is drizzle's nested transaction, which the postgres-js driver
 * issues as SAVEPOINT / ROLLBACK TO SAVEPOINT: a throw inside the callback
 * comes back out, and the outer handle keeps working afterwards. Copied from
 * financial-meta.test.ts.
 */
function makeTx() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
}

describe('reversePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // payment_records.amount is the cash received, so the reversal outflow must
  // match it: a R$900 overpayment against a R$791 charge writes a R$900
  // outflow, or the cash ledger would be short by the excess forever.
  it('reversing a R$900 overpayment writes a R$900 outflow, not the amount it allocated', async () => {
    const { reversePayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: PAYMENT_RECORD_ID, installmentId: INSTALLMENT_ID, amount: '900.00', paymentMethod: 'pix' }]),
    ) // pr
    tx.select.mockReturnValueOnce(chain([installmentRow({ status: 'pending' })])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x', status: 'partial' }])) // entry lock
    tx.select.mockReturnValueOnce(chain([{ reversedAt: null }])) // locked re-read
    tx.update.mockReturnValueOnce(chain(undefined)) // mark payment reversed

    const cashInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, cashInsert)) // cashMovements outflow

    tx.select.mockReturnValueOnce(chain([])) // remainingPayments, none left
    tx.update.mockReturnValueOnce(chain(undefined)) // reset installment

    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus select
    tx.update.mockReturnValueOnce(chain(undefined)) // updateEntryStatus's financialEntries update

    tx.insert.mockReturnValueOnce(chain(undefined)) // createAuditLog

    const result = await reversePayment(TENANT, USER_ID, PAYMENT_RECORD_ID, 'estorno de teste')

    expect(result).toEqual({ success: true })
    expect(cashInsert.value).toMatchObject({ type: 'outflow', amount: '900.00' })
  })

  // The remaining payment absorbs the fine on replay once the one that first
  // triggered it is reversed: fineApplied is recomputed from scratch against
  // whatever payments are left.
  it('reversing the payment that triggered the fine leaves the remaining payment covering it', async () => {
    const { reversePayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: 'p1', installmentId: INSTALLMENT_ID, amount: '30.00', paymentMethod: 'pix' }]),
    ) // pr (p1, being reversed)
    tx.select.mockReturnValueOnce(chain([installmentRow({ status: 'pending' })])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x', status: 'partial' }])) // entry lock
    tx.select.mockReturnValueOnce(chain([{ reversedAt: null }])) // locked re-read
    tx.update.mockReturnValueOnce(chain(undefined)) // mark p1 reversed
    tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements outflow

    // p2 is what is left once p1 is reversed: due May 22, paid Jul 22 is 61
    // days overdue. fine = 750 * 2% = 15. interest = 750 * 1%/30 * 61 = 15.25.
    // 30 covers interest (15.25) then 14.75 of the 15 fine, leaving 0.25 of
    // the fine and no principal touched.
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p2',
          amount: '30.00',
          paidAt: '2026-07-22T12:00:00.000Z',
          recordedAt: '2026-07-22T12:00:00.000Z',
          paymentMethod: 'pix',
        },
      ]),
    ) // remainingPayments

    const rewrite: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, rewrite)) // rewrite of p2
    tx.update.mockReturnValueOnce(chain(undefined)) // final installment update

    tx.select.mockReturnValueOnce(chain([{ status: 'partial', amountPaid: '0' }])) // updateEntryStatus select
    tx.update.mockReturnValueOnce(chain(undefined)) // updateEntryStatus's financialEntries update

    tx.insert.mockReturnValueOnce(chain(undefined)) // createAuditLog

    await reversePayment(TENANT, USER_ID, 'p1')

    expect(rewrite.value).toMatchObject({ fineCovered: '14.75' })
  })

  it('keeps a renegotiated original renegotiated and its cancelled installment cancelled when its payment is reversed', async () => {
    const { reversePayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: PAYMENT_RECORD_ID, installmentId: INSTALLMENT_ID, amount: '100.00', paymentMethod: 'pix' }]),
    ) // pr
    tx.select.mockReturnValueOnce(chain([installmentRow({ status: 'cancelled' })])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x', status: 'renegotiated' }])) // entry lock
    tx.select.mockReturnValueOnce(chain([{ reversedAt: null }])) // locked re-read
    tx.update.mockReturnValueOnce(chain(undefined)) // mark payment reversed
    const cashInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, cashInsert)) // cashMovements outflow
    tx.select.mockReturnValueOnce(chain([])) // live payments, none left
    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentUpdate)) // reset installment
    // A recompute here would read the installments and write the entry.
    tx.select.mockReturnValueOnce(chain([{ status: 'cancelled', amountPaid: '0' }]))
    const entryUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, entryUpdate))
    tx.insert.mockReturnValueOnce(chain(undefined)) // createAuditLog

    await reversePayment(TENANT, USER_ID, PAYMENT_RECORD_ID)

    expect(cashInsert.value).toMatchObject({ type: 'outflow', amount: '100.00' })
    expect(installmentUpdate.value).toMatchObject({ status: 'cancelled', amountPaid: '0' })
    expect(entryUpdate.value).toBeUndefined()
  })
})

describe('reversePayment locking', () => {
  const STALE = installmentRow()
  // Uncancelled between the unlocked read and the lock: the pause from May 25
  // to Aug 25 is now on the row.
  const LOCKED = installmentRow({
    status: 'pending',
    penaltyPauses: [{ from: '2026-05-25T15:00:00.000Z', to: '2026-08-25T15:00:00.000Z' }],
  })
  const P2 = {
    id: 'p2',
    installmentId: INSTALLMENT_ID,
    amount: '30.00',
    interestCovered: '15.25',
    fineCovered: '14.75',
    principalCovered: '0.00',
    paidAt: '2026-07-22T12:00:00.000Z',
    recordedAt: '2026-07-22T12:00:00.000Z',
    paymentMethod: 'pix',
    reversedAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function reverse(opts: { entryStatus?: string; locked?: Record<string, unknown>; live?: unknown[] } = {}) {
    const locked = { ...LOCKED, ...opts.locked }
    const { reversePayment } = await import('../financial')
    const { financialEntries, installments, paymentRecords } = await import('@/db/schema')
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op !== 'select') return undefined
      if (table === paymentRecords) {
        const live = (q.capture.calls ?? []).some(([method]) => method === 'orderBy')
        return live ? (opts.live ?? [P2]) : [{ ...P2, id: PAYMENT_RECORD_ID, amount: '100.00' }]
      }
      if (table === installments) {
        if (isLock(q)) return [locked]
        const fields = Object.keys((q.fields as object | undefined) ?? {})
        return fields.includes('amountPaid') ? [{ status: 'pending', amountPaid: '14.25' }] : [STALE]
      }
      if (table === financialEntries) {
        return [{ patientId: PATIENT_ID, description: 'x', status: opts.entryStatus ?? 'partial' }]
      }
      return []
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
    await reversePayment(TENANT, USER_ID, PAYMENT_RECORD_ID)
    return { log, paymentRecords, installments, financialEntries }
  }

  // Priced with the pause, p2 on Jul 22 is three days late: interest 0.75,
  // fine 15, principal 14.25. Without it, 61 days: 15.25 and 14.75.
  it('prices the remaining payments from the installment row read under the lock', async () => {
    const { log, paymentRecords } = await reverse()

    const rewrites = log.filter((q) => q.op === 'update' && tableOf(q) === paymentRecords && q.capture.value && 'fineCovered' in (q.capture.value as object))
    expect(rewrites.map((q) => q.capture.value)).toEqual([
      { interestCovered: '0.75', fineCovered: '15.00', principalCovered: '14.25' },
    ])
  })

  it('locks the entry after the installment and before the entry status is recomputed', async () => {
    const { log, installments, financialEntries } = await reverse()

    const installmentLock = log.findIndex((q) => isLock(q) && tableOf(q) === installments)
    const entryLock = log.findIndex((q) => isLock(q) && tableOf(q) === financialEntries)
    const siblingsRead = log.findIndex(
      (q) => q.op === 'select' && tableOf(q) === installments && Object.keys((q.fields as object | undefined) ?? {}).includes('amountPaid'),
    )
    expect(entryLock).toBeGreaterThan(-1)
    expect(installmentLock).toBeLessThan(entryLock)
    expect(entryLock).toBeLessThan(siblingsRead)
  })

  it('reversing the only payment of a paid installment of a renegotiated entry reopens the installment and leaves the entry renegotiated', async () => {
    const { log, installments, financialEntries } = await reverse({
      entryStatus: 'renegotiated',
      locked: { status: 'paid' },
      live: [],
    })

    const installmentUpdate = log.find((q) => q.op === 'update' && tableOf(q) === installments)
    expect(installmentUpdate?.capture.value).toMatchObject({ status: 'pending', amountPaid: '0', paidAt: null })
    expect(log.some((q) => q.op === 'update' && tableOf(q) === financialEntries)).toBe(false)
  })
})

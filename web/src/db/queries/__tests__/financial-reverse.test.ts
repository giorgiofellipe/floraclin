import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    ...overrides,
  }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

/**
 * `transaction` is drizzle's nested transaction, which the postgres-js driver
 * issues as SAVEPOINT / ROLLBACK TO SAVEPOINT: a throw inside the callback
 * comes back out, and the outer handle keeps working afterwards. Copied from
 * financial-meta.test.ts.
 */
function makeTx() {
  return {
    execute: vi.fn(),
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
  // outflow, or the cash ledger would be short by the excess forever. This
  // characterises reversePayment, which already wrote pr.amount; what changed
  // is that recordPayment now stores the full amount there.
  it('reversing a R$900 overpayment writes a R$900 outflow, not the amount it allocated', async () => {
    const { reversePayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: PAYMENT_RECORD_ID, installmentId: INSTALLMENT_ID, amount: '900.00', paymentMethod: 'pix' }]),
    ) // pr
    tx.select.mockReturnValueOnce(chain([installmentRow()])) // inst (ownership)
    tx.execute.mockResolvedValueOnce(undefined) // FOR UPDATE lock
    tx.select.mockReturnValueOnce(chain([{ reversedAt: null }])) // locked re-read
    tx.update.mockReturnValueOnce(chain(undefined)) // mark payment reversed
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo

    const cashInsert: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, cashInsert)) // cashMovements outflow

    tx.select.mockReturnValueOnce(chain([])) // remainingPayments, none left
    tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays
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
  // whatever payments are left. This held before this round too; it pins the
  // shape reversal must keep while the engine underneath it changes.
  it('reversing the payment that triggered the fine leaves the remaining payment covering it', async () => {
    const { reversePayment } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([{ id: 'p1', installmentId: INSTALLMENT_ID, amount: '30.00', paymentMethod: 'pix' }]),
    ) // pr (p1, being reversed)
    tx.select.mockReturnValueOnce(chain([installmentRow()])) // inst (ownership)
    tx.execute.mockResolvedValueOnce(undefined) // FOR UPDATE lock
    tx.select.mockReturnValueOnce(chain([{ reversedAt: null }])) // locked re-read
    tx.update.mockReturnValueOnce(chain(undefined)) // mark p1 reversed
    tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }])) // entryInfo
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
    tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays

    const rewrite: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, rewrite)) // rewrite of p2
    tx.update.mockReturnValueOnce(chain(undefined)) // final installment update

    tx.select.mockReturnValueOnce(chain([{ status: 'partial', amountPaid: '0' }])) // updateEntryStatus select
    tx.update.mockReturnValueOnce(chain(undefined)) // updateEntryStatus's financialEntries update

    tx.insert.mockReturnValueOnce(chain(undefined)) // createAuditLog

    await reversePayment(TENANT, USER_ID, 'p1')

    expect(rewrite.value).toMatchObject({ fineCovered: '14.75' })
  })
})

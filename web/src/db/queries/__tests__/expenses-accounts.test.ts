import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routedTx, tableOf, type LoggedQuery } from '@/tests/mocks/drizzle-tx'
import { cashMovements } from '@/db/schema'

const valuesOfLogged = (q: LoggedQuery) => q.capture.value as Record<string, unknown>

const dbMock = { transaction: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))

// Resolution itself is covered in financial-accounts.test.ts.
const resolveMovementAccountIdMock = vi.fn(async (..._args: unknown[]) => 'acct-default')
const expenseOutflowForReversalMock = vi.fn(async (..._args: unknown[]) => ({ movementId: 'mov-0', accountId: 'acct-drawer' }))
vi.mock('../financial-accounts', () => ({
  resolveMovementAccountId: (...args: unknown[]) => resolveMovementAccountIdMock(...args),
  expenseOutflowForReversal: (...args: unknown[]) => expenseOutflowForReversalMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000x001'

function expenseTx(locked: Record<string, unknown>) {
  const routed = routedTx((q) => {
    if (q.op === 'insert' && tableOf(q) === cashMovements) return [{ id: 'mov-new' }]
    if (q.op === 'update') return [{ id: INSTALLMENT_ID }]
    if (q.op === 'select') return [{ status: 'paid' }]
    return undefined
  })
  const tx = { ...routed.tx, execute: vi.fn(async () => [locked]) }
  dbMock.transaction.mockImplementationOnce(async (cb: (t: unknown) => unknown) => cb(tx))
  return { tx, log: routed.log }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('expense payments and accounts', () => {
  it('pays an expense from the account picked, through the account resolution', async () => {
    const { payExpenseInstallment } = await import('../expenses')
    const { tx, log } = expenseTx({
      id: INSTALLMENT_ID, expense_id: 'exp-1', amount: '120.00', status: 'pending', installment_number: 1, category_id: 'cat-1',
    })

    await payExpenseInstallment(TENANT, INSTALLMENT_ID, 'pix', USER_ID, undefined, 'acct-picked')

    expect(resolveMovementAccountIdMock).toHaveBeenCalledWith(tx, TENANT, { accountId: 'acct-picked', method: 'pix' })
    const outflow = log.find((q) => q.op === 'insert' && tableOf(q) === cashMovements)
    expect(valuesOfLogged(outflow!)).toMatchObject({ type: 'outflow', amount: '120.00', accountId: 'acct-default' })
  })

  it("puts the reversal inflow on the account the payment left from", async () => {
    const { revertExpenseInstallmentPayment } = await import('../expenses')
    const { tx, log } = expenseTx({
      id: INSTALLMENT_ID, expense_id: 'exp-1', amount: '120.00', status: 'paid', installment_number: 1,
      paid_at: '2026-10-01T15:00:00Z', payment_method: 'cash', expense_status: 'paid', category_id: 'cat-1',
    })

    await revertExpenseInstallmentPayment(TENANT, INSTALLMENT_ID, USER_ID)

    expect(expenseOutflowForReversalMock).toHaveBeenCalledWith(tx, TENANT, INSTALLMENT_ID)
    const counter = log.find((q) => q.op === 'insert' && tableOf(q) === cashMovements)
    expect(valuesOfLogged(counter!)).toMatchObject({ type: 'inflow', paymentMethod: null, accountId: 'acct-drawer' })
  })
})

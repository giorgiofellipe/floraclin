import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routedTx, tableOf, whereParams, type LoggedQuery } from '@/tests/mocks/drizzle-tx'
import { cashMovements, financialAccounts } from '@/db/schema'
import { parseBrDate } from '@/lib/dates'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const createAuditLogMock = vi.fn()
vi.mock('@/lib/audit', () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const CASH = '00000000-0000-0000-0000-0000000ac001'
const BANK = '00000000-0000-0000-0000-0000000ac002'
const ACQUIRER = '00000000-0000-0000-0000-0000000ac003'
const LEGACY = '00000000-0000-0000-0000-0000000ac004'

const active = (...rows: { id: string; kind: string; isDefault: boolean }[]) => rows

function useTx(resolve: (q: LoggedQuery) => unknown) {
  const routed = routedTx(resolve)
  dbMock.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(routed.tx))
  return routed
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveMovementAccountId', () => {
  it("refuses a picked account the clinic doesn't own or has archived, asking only for its own live ones", async () => {
    const { resolveMovementAccountId } = await import('../financial-accounts')
    const { tx, log } = routedTx(() => [])

    await expect(resolveMovementAccountId(tx as never, TENANT, { accountId: BANK })).rejects.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_NOT_FOUND',
    })
    expect(tableOf(log[0])).toBe(financialAccounts)
    expect(whereParams(log[0].capture)).toEqual(expect.arrayContaining([TENANT, BANK]))
  })

  it.each([
    ['cash', CASH],
    ['pix', BANK],
    ['transfer', BANK],
    [null, BANK],
  ])('sends a %s movement to the default account of its kind', async (method, expected) => {
    const { resolveMovementAccountId } = await import('../financial-accounts')
    const { tx } = routedTx(() =>
      active(
        { id: LEGACY, kind: 'legacy', isDefault: false },
        { id: CASH, kind: 'cash', isDefault: true },
        { id: BANK, kind: 'bank', isDefault: true },
      ),
    )

    expect(await resolveMovementAccountId(tx as never, TENANT, { method })).toBe(expected)
  })

  it("prefers a terminal's live payout account, and falls back to the bank once it is archived", async () => {
    const { resolveMovementAccountId } = await import('../financial-accounts')
    const withAcquirer = routedTx(() =>
      active({ id: BANK, kind: 'bank', isDefault: true }, { id: ACQUIRER, kind: 'acquirer', isDefault: false }),
    )
    const archived = routedTx(() => active({ id: BANK, kind: 'bank', isDefault: true }))

    expect(await resolveMovementAccountId(withAcquirer.tx as never, TENANT, { preferredAccountId: ACQUIRER })).toBe(ACQUIRER)
    expect(await resolveMovementAccountId(archived.tx as never, TENANT, { preferredAccountId: ACQUIRER })).toBe(BANK)
  })

  it('keeps a pre-account clinic on its legacy account until it sets a default of that kind', async () => {
    const { resolveMovementAccountId } = await import('../financial-accounts')
    const { tx, log } = routedTx(() =>
      active({ id: LEGACY, kind: 'legacy', isDefault: false }, { id: BANK, kind: 'bank', isDefault: true }),
    )

    expect(await resolveMovementAccountId(tx as never, TENANT, { method: 'cash' })).toBe(LEGACY)
    expect(log.some((q) => q.op === 'insert')).toBe(false)
  })

  it('provisions a new clinic its default Caixa on its first cash movement', async () => {
    const { resolveMovementAccountId } = await import('../financial-accounts')
    let selects = 0
    const { tx, log } = routedTx((q) => {
      if (q.op !== 'select') return undefined
      selects += 1
      return selects === 1 ? [] : [{ id: CASH }]
    })

    expect(await resolveMovementAccountId(tx as never, TENANT, { method: 'cash' })).toBe(CASH)
    const insert = log.find((q) => q.op === 'insert')!
    expect(tableOf(insert)).toBe(financialAccounts)
    expect(insert.capture.value).toEqual({ tenantId: TENANT, kind: 'cash', name: 'Caixa', isDefault: true })
    // A concurrent first payment hits uq_financial_accounts_default and reads the winner's row.
    expect(insert.capture.calls?.some(([method]) => method === 'onConflictDoNothing')).toBe(true)
  })
})

describe('reversalAccountId', () => {
  it("returns the original movement's account without looking anything up, even if archived since", async () => {
    const { reversalAccountId } = await import('../financial-accounts')
    const { tx, log } = routedTx(() => [])

    expect(await reversalAccountId(tx as never, TENANT, BANK)).toBe(BANK)
    expect(log).toHaveLength(0)
  })

  it('sends the reversal of a movement old code wrote without an account to the legacy account', async () => {
    const { reversalAccountId } = await import('../financial-accounts')
    const { tx, log } = routedTx((q) => (q.op === 'select' ? [{ id: LEGACY }] : []))

    expect(await reversalAccountId(tx as never, TENANT, null)).toBe(LEGACY)
    // Never the method's default: 0051 puts the original on legacy, so the
    // reversal must land there too or a fully reversed payment leaves +x / -x.
    expect(log.map((q) => q.op)).toEqual(['insert', 'select'])
    expect(log[0].capture.value).toEqual({ tenantId: TENANT, kind: 'legacy', name: 'Geral (antes das contas)' })
    expect(log[0].capture.calls?.map(([m]) => m)).toContain('onConflictDoNothing')
    expect(whereParams(log[1].capture)).toEqual(expect.arrayContaining([TENANT, 'legacy']))
  })

  it("creates the legacy account for a clinic whose first movement came from old code, instead of a bank default", async () => {
    const { reversalAccountId } = await import('../financial-accounts')
    let created = false
    const { tx, log } = routedTx((q) => {
      if (q.op === 'insert') {
        created = true
        return []
      }
      return created ? [{ id: LEGACY }] : []
    })

    expect(await reversalAccountId(tx as never, TENANT, null)).toBe(LEGACY)
    expect(log.filter((q) => q.op === 'insert')).toHaveLength(1)
    expect(log[0].capture.value).toMatchObject({ kind: 'legacy' })
  })
})

describe('createTransfer', () => {
  const transfer = { fromAccountId: BANK, toAccountId: CASH, amount: 150, date: '2026-11-02' }

  it('refuses a transfer to the same account before opening a transaction', async () => {
    const { createTransfer } = await import('../financial-accounts')

    await expect(createTransfer(TENANT, USER_ID, { ...transfer, toAccountId: BANK })).rejects.toMatchObject({
      code: 'TRANSFER_SAME_ACCOUNT',
    })
    expect(dbMock.transaction).not.toHaveBeenCalled()
  })

  it("refuses when either account isn't a live account of the clinic, and writes nothing", async () => {
    const { createTransfer } = await import('../financial-accounts')
    const { log } = useTx((q) => (q.op === 'select' ? [{ id: BANK, name: 'Itaú' }] : undefined))

    await expect(createTransfer(TENANT, USER_ID, transfer)).rejects.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_NOT_FOUND',
    })
    expect(whereParams(log[0].capture)).toEqual(expect.arrayContaining([TENANT, BANK, CASH]))
    expect(log.some((q) => q.op === 'insert')).toBe(false)
  })

  it('writes both legs in one insert, sharing a transfer id, on the BR day picked', async () => {
    const { createTransfer } = await import('../financial-accounts')
    const { log } = useTx((q) =>
      q.op === 'select'
        ? [
            { id: CASH, name: 'Caixa' },
            { id: BANK, name: 'Itaú' },
          ]
        : undefined,
    )

    const { transferGroupId } = await createTransfer(TENANT, USER_ID, transfer)

    const inserts = log.filter((q) => q.op === 'insert' && tableOf(q) === cashMovements)
    expect(inserts).toHaveLength(1)
    const legs = inserts[0].capture.value as Record<string, unknown>[]
    const shared = {
      tenantId: TENANT,
      amount: '150.00',
      description: 'Transferência: Itaú → Caixa',
      paymentMethod: null,
      movementDate: parseBrDate('2026-11-02', '12:00:00'),
      recordedBy: USER_ID,
      transferGroupId,
    }
    expect(legs).toEqual([
      { ...shared, type: 'outflow', accountId: BANK },
      { ...shared, type: 'inflow', accountId: CASH },
    ])
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'financial_transfer', entityId: transferGroupId }),
      expect.anything(),
    )
  })

  it('propagates a failed insert without auditing a transfer that never happened', async () => {
    const { createTransfer } = await import('../financial-accounts')
    useTx((q) => {
      if (q.op === 'insert') throw new Error('numeric field overflow')
      return [
        { id: CASH, name: 'Caixa' },
        { id: BANK, name: 'Itaú' },
      ]
    })

    await expect(createTransfer(TENANT, USER_ID, transfer)).rejects.toThrow('numeric field overflow')
    expect(createAuditLogMock).not.toHaveBeenCalled()
  })
})

describe('createFinancialAccount', () => {
  const bank = {
    kind: 'bank' as const,
    name: 'Itaú',
    bankName: null,
    bankAgency: null,
    bankAccount: null,
    isDefault: false,
    openingBalance: 0,
    openingBalanceDate: null,
  }

  it.each([
    ['makes the first bank account the default', [], true],
    ['leaves a second bank account alone', [{ id: BANK }], false],
  ])('%s', async (_name, existingDefault, expected) => {
    const { createFinancialAccount } = await import('../financial-accounts')
    const { log } = useTx((q) => (q.op === 'select' ? existingDefault : [{ id: 'new' }]))

    await createFinancialAccount(TENANT, USER_ID, bank)

    const insert = log.find((q) => q.op === 'insert' && tableOf(q) === financialAccounts)!
    expect(insert.capture.value).toMatchObject({ tenantId: TENANT, kind: 'bank', isDefault: expected })
  })
})

describe('updateFinancialAccount', () => {
  it('only renames the legacy account, so its history never gets an opening balance on top', async () => {
    const { updateFinancialAccount } = await import('../financial-accounts')
    const { log } = useTx((q) => {
      if (q.op === 'select') return [{ id: LEGACY, kind: 'legacy', isDefault: false, archivedAt: null }]
      return [{ id: LEGACY }]
    })

    await updateFinancialAccount(TENANT, USER_ID, LEGACY, {
      name: 'Histórico',
      bankName: null,
      bankAgency: null,
      bankAccount: null,
      isDefault: true,
      openingBalance: 500,
      openingBalanceDate: '2026-09-01',
    })

    const update = log.find((q) => q.op === 'update')!
    expect(update.capture.value).toEqual({ name: 'Histórico', updatedAt: expect.any(Date) })
  })

  it('clears the previous default of the kind before making another account the default', async () => {
    const { updateFinancialAccount } = await import('../financial-accounts')
    const { log } = useTx((q) => {
      if (q.op === 'select') return [{ id: BANK, kind: 'bank', isDefault: false, archivedAt: null, openingBalance: '0.00', openingBalanceDate: null }]
      return [{ id: BANK, openingBalance: '0.00', openingBalanceDate: null }]
    })

    await updateFinancialAccount(TENANT, USER_ID, BANK, {
      name: 'Itaú',
      bankName: null,
      bankAgency: null,
      bankAccount: null,
      isDefault: true,
      openingBalance: 0,
      openingBalanceDate: null,
    })

    const [clear, write] = log.filter((q) => q.op === 'update')
    expect(clear.capture.value).toEqual({ isDefault: false, updatedAt: expect.any(Date) })
    expect(whereParams(clear.capture)).toEqual(expect.arrayContaining([TENANT, 'bank', true]))
    expect(write.capture.value).toMatchObject({ isDefault: true })
  })
})

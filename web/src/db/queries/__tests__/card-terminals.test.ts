import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chain, routedTx, tableOf, whereParams } from '@/tests/mocks/drizzle-tx'
import { cardTerminals } from '@/db/schema'
import type { CardTerminalInput } from '@/validations/card-terminals'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const OTHER_TENANT = '00000000-0000-0000-0000-00000000a002'
const USER = '00000000-0000-0000-0000-0000000000u1'
const TERMINAL = '00000000-0000-0000-0000-00000000c001'

function input(overrides: Partial<CardTerminalInput> = {}): CardTerminalInput {
  return {
    name: 'Stone',
    isDefault: false,
    debitRate: 1.5,
    debitPayoutDays: 1,
    creditRates: Array.from({ length: 12 }, (_, i) => 2 + i),
    creditPayoutMode: 'per_installment',
    creditLumpSumDays: 1,
    ...overrides,
  }
}

function useTx(resolve: Parameters<typeof routedTx>[0]) {
  const { tx, log } = routedTx(resolve)
  dbMock.transaction.mockImplementationOnce(async (cb: (t: unknown) => unknown) => cb(tx))
  return log
}

const terminalWrites = (log: ReturnType<typeof useTx>) =>
  log.filter((q) => q.op !== 'select' && tableOf(q) === cardTerminals)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCardTerminal', () => {
  it('makes the first terminal the default even when the form says otherwise', async () => {
    const { createCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => {
      if (q.op === 'select') return [{ value: 0 }]
      return [{ id: TERMINAL }]
    })

    await createCardTerminal(TENANT, USER, input({ isDefault: false }))

    const insert = log.find((q) => q.op === 'insert' && tableOf(q) === cardTerminals)!
    expect(insert.capture.value).toMatchObject({ tenantId: TENANT, isDefault: true })
  })

  it('clears the default on the tenant other terminals before inserting a new default', async () => {
    const { createCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => (q.op === 'select' ? [{ value: 2 }] : [{ id: TERMINAL }]))

    await createCardTerminal(TENANT, USER, input({ isDefault: true }))

    const writes = terminalWrites(log)
    expect(writes.map((q) => q.op)).toEqual(['update', 'insert'])
    expect(writes[0].capture.value).toMatchObject({ isDefault: false })
    expect(whereParams(writes[0].capture)).toContain(TENANT)
  })

  it('stores rates as 2-decimal strings', async () => {
    const { createCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => (q.op === 'select' ? [{ value: 1 }] : [{ id: TERMINAL }]))

    await createCardTerminal(TENANT, USER, input({ debitRate: 1.5 }))

    const insert = log.find((q) => q.op === 'insert' && tableOf(q) === cardTerminals)!
    expect(insert.capture.value).toMatchObject({ debitRate: '1.50' })
    expect((insert.capture.value as { creditRates: string[] }).creditRates[0]).toBe('2.00')
  })
})

describe('updateCardTerminal', () => {
  it('clears the other defaults when this terminal becomes the default', async () => {
    const { updateCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => (q.op === 'select' ? [{ id: TERMINAL }] : [{ id: TERMINAL }]))

    await updateCardTerminal(TENANT, USER, TERMINAL, input({ isDefault: true }))

    const updates = terminalWrites(log)
    expect(updates).toHaveLength(2)
    expect(updates[0].capture.value).toMatchObject({ isDefault: false })
    expect(updates[1].capture.value).toMatchObject({ isDefault: true })
  })

  it('rejects a terminal that belongs to another tenant', async () => {
    const { updateCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => (q.op === 'select' ? [] : [{ id: TERMINAL }]))

    await expect(updateCardTerminal(OTHER_TENANT, USER, TERMINAL, input())).rejects.toThrow(
      'Maquininha não encontrada',
    )
    const lookup = log.find((q) => q.op === 'select')!
    expect(whereParams(lookup.capture)).toContain(OTHER_TENANT)
    expect(terminalWrites(log)).toHaveLength(0)
  })
})

describe('deleteCardTerminal', () => {
  it('soft deletes within the tenant and clears the default flag', async () => {
    const { deleteCardTerminal } = await import('../card-terminals')
    const log = useTx((q) => (q.op === 'select' ? [{ id: TERMINAL }] : [{ id: TERMINAL }]))

    await deleteCardTerminal(TENANT, USER, TERMINAL)

    const [update] = terminalWrites(log)
    expect(update.capture.value).toMatchObject({ isDefault: false })
    expect((update.capture.value as { deletedAt: Date }).deletedAt).toBeInstanceOf(Date)
    expect(whereParams(update.capture)).toContain(TENANT)
  })
})

describe('listCardTerminals', () => {
  it('filters by tenant', async () => {
    const { listCardTerminals } = await import('../card-terminals')
    const capture: import('@/tests/mocks/drizzle-tx').Capture = {}
    dbMock.select.mockReturnValueOnce(chain([], capture))

    await listCardTerminals(TENANT)

    expect(whereParams(capture)).toContain(TENANT)
  })
})

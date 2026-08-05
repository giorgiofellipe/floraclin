import { describe, it, expect, vi, beforeEach } from 'vitest'

// listLedgerReportRows issues a single select/join/where/orderBy chain. We
// drive a fake `db` that returns a canned row array when the chain is
// awaited; every chain method is a no-op that returns the same node.
const { queuedRows, setRows, whereCalls } = vi.hoisted(() => {
  let rows: unknown[] = []
  const whereCalls: unknown[] = []
  return {
    queuedRows: () => rows,
    setRows: (r: unknown[]) => {
      rows = r
    },
    whereCalls,
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => {
      const node: Record<string, unknown> = {}
      node.from = () => node
      node.leftJoin = () => node
      node.where = (...args: unknown[]) => {
        whereCalls.push(args)
        return node
      }
      node.orderBy = () => node
      node.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(queuedRows()).then(resolve, reject)
      return node
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  cashMovements: {
    tenantId: 'tenant_id',
    type: 'type',
    amount: 'amount',
    description: 'description',
    paymentMethod: 'payment_method',
    movementDate: 'movement_date',
    patientId: 'patient_id',
    expenseCategoryId: 'expense_category_id',
  },
  patients: { id: 'id', fullName: 'full_name' },
  expenseCategories: { id: 'id', name: 'name' },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ['and', ...args],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  desc: (a: unknown) => ['desc', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lte: (a: unknown, b: unknown) => ['lte', a, b],
}))

import { listLedgerReportRows } from '../extrato-periodo'

function row(overrides: {
  type?: 'inflow' | 'outflow'
  amount?: string
  description?: string
  paymentMethod?: string | null
  movementDate?: Date
  patientName?: string | null
  categoryName?: string | null
} = {}) {
  return {
    type: 'inflow' as const,
    amount: '100.00',
    description: 'Procedimento',
    paymentMethod: 'pix',
    movementDate: new Date('2026-04-10T15:00:00Z'),
    patientName: 'Ana Souza',
    categoryName: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setRows([])
  whereCalls.length = 0
})

describe('listLedgerReportRows', () => {
  it('scopes the query by tenantId and the BR-anchored date range', async () => {
    setRows([row()])

    await listLedgerReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(whereCalls).toHaveLength(1)
    const [andCall] = whereCalls[0] as [unknown[]]
    // Our `and` mock returns ['and', eq(...), gte(...), lte(...)].
    const [, ...conditions] = andCall
    expect(conditions[0]).toEqual(['eq', 'tenant_id', 'tenant-1'])
    expect((conditions[1] as unknown[])[0]).toBe('gte')
    expect((conditions[2] as unknown[])[0]).toBe('lte')
  })

  it('converts the decimal amount string to a number', async () => {
    setRows([row({ amount: '1234.56' })])

    const [result] = await listLedgerReportRows('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.amount).toBe(1234.56)
  })

  it('falls back to the category name when there is no patient', async () => {
    setRows([row({ patientName: null, categoryName: 'Aluguel' })])

    const [result] = await listLedgerReportRows('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.patientName).toBeNull()
    expect(result.categoryName).toBe('Aluguel')
  })

  it('caps the result at 200 rows after sorting', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      row({ amount: String(i), movementDate: new Date(Date.UTC(2026, 3, 1 + (i % 28))) }),
    )
    setRows(many)

    const result = await listLedgerReportRows('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      sort: { key: 'amount', dir: 'desc' },
    })

    expect(result).toHaveLength(200)
    // Sorted descending by amount before the cap, so the highest amounts survive.
    expect(result[0].amount).toBe(249)
  })

  it('sorts by movementDate when requested', async () => {
    setRows([
      row({ amount: '1', movementDate: new Date('2026-04-05T12:00:00Z') }),
      row({ amount: '2', movementDate: new Date('2026-04-15T12:00:00Z') }),
    ])

    const result = await listLedgerReportRows('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      sort: { key: 'movementDate', dir: 'asc' },
    })

    expect(result.map((r) => r.amount)).toEqual([1, 2])
  })

  it('leaves rows in the query default (most recent first) order when no sort is given', async () => {
    setRows([row({ amount: '1' }), row({ amount: '2' })])

    const result = await listLedgerReportRows('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.map((r) => r.amount)).toEqual([1, 2])
  })
})

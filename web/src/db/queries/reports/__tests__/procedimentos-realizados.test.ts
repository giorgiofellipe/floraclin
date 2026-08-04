import { describe, it, expect, vi, beforeEach } from 'vitest'

// listProcedureApplications issues a single select/join/where/orderBy
// chain. We drive a fake `db` that returns a canned row array when the
// chain is awaited; every chain method is a no-op that returns the same
// node, and `where` records the conditions it was called with so tests can
// assert on tenant/date/practitioner scoping.
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
      node.innerJoin = () => node
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
  productApplications: {
    id: 'id',
    tenantId: 'tenant_id',
    procedureRecordId: 'procedure_record_id',
    productName: 'product_name',
    activeIngredient: 'active_ingredient',
    totalQuantity: 'total_quantity',
    quantityUnit: 'quantity_unit',
    batchNumber: 'batch_number',
    expirationDate: 'expiration_date',
  },
  procedureRecords: {
    id: 'id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    performedAt: 'performed_at',
    patientId: 'patient_id',
    practitionerId: 'practitioner_id',
  },
  patients: { id: 'id', fullName: 'full_name', deletedAt: 'deleted_at' },
  users: { id: 'id', fullName: 'full_name', deletedAt: 'deleted_at' },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ['and', ...args],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  desc: (a: unknown) => ['desc', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lte: (a: unknown, b: unknown) => ['lte', a, b],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

import { listProcedureApplications } from '../procedimentos-realizados'

function row(overrides: {
  id?: string
  performedAt?: Date | null
  patientName?: string
  practitionerName?: string
  productName?: string
  activeIngredient?: string | null
  totalQuantity?: string
  quantityUnit?: string
  batchNumber?: string | null
  expirationDate?: string | null
} = {}) {
  return {
    id: 'app-1',
    performedAt: new Date('2026-04-10T15:00:00Z'),
    patientName: 'Ana Souza',
    practitionerName: 'Dra. Beatriz',
    productName: 'Botox',
    activeIngredient: 'Toxina botulínica',
    totalQuantity: '20.00',
    quantityUnit: 'U',
    batchNumber: 'L12345',
    expirationDate: '2027-01-01',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setRows([])
  whereCalls.length = 0
})

describe('listProcedureApplications', () => {
  it('scopes by tenantId on both product_applications and procedure_records, and excludes soft-deleted rows', async () => {
    setRows([row()])

    await listProcedureApplications('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(whereCalls).toHaveLength(1)
    const [conditions] = whereCalls[0] as [unknown[]]
    expect(conditions).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    expect(conditions).toContainEqual(['isNull', 'deleted_at'])
  })

  it('adds a practitionerId condition only when one is given', async () => {
    setRows([])

    await listProcedureApplications('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      practitionerId: 'prat-1',
    })

    const [conditions] = whereCalls[0] as [unknown[]]
    expect(conditions).toContainEqual(['eq', 'practitioner_id', 'prat-1'])
  })

  it('omits the practitionerId condition when none is given', async () => {
    setRows([])

    await listProcedureApplications('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    const [conditions] = whereCalls[0] as [unknown[]]
    const hasPractitionerCondition = conditions.some(
      (c) => Array.isArray(c) && c[0] === 'eq' && c[1] === 'practitioner_id',
    )
    expect(hasPractitionerCondition).toBe(false)
  })

  it('converts the decimal totalQuantity string to a number', async () => {
    setRows([row({ totalQuantity: '12.50' })])

    const [result] = await listProcedureApplications('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.totalQuantity).toBe(12.5)
  })

  it('passes through a null batch number and expiration date as null, not a placeholder', async () => {
    setRows([row({ batchNumber: null, expirationDate: null })])

    const [result] = await listProcedureApplications('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.batchNumber).toBeNull()
    expect(result.expirationDate).toBeNull()
  })

  it('sorts by productName when requested', async () => {
    setRows([row({ id: 'a', productName: 'Zylast' }), row({ id: 'b', productName: 'Acido' })])

    const result = await listProcedureApplications('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      sort: { key: 'productName', dir: 'asc' },
    })

    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('caps the result at 200 rows after sorting', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      row({ id: `app-${i}`, performedAt: new Date(Date.UTC(2026, 3, 1 + (i % 28))) }),
    )
    setRows(many)

    const result = await listProcedureApplications('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result).toHaveLength(200)
  })
})

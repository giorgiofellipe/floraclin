import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// listInactivePatients issues three independent selects (patients, the
// latest procedure per patient via selectDistinctOn, and paid-installment
// totals per patient) and joins them in JS. We drive a fake `db` with a FIFO
// queue of results, one array per top-level `db.select(...)` /
// `db.selectDistinctOn(...)` call, in the exact order the module issues
// them: patients, then last-procedures, then lifetime values. Every chain
// method (from/innerJoin/where/orderBy/groupBy) is a no-op that returns the
// same node; only awaiting the chain (its `.then`) shifts the queue, so call
// order — not resolution order — determines which canned result lands where.
const { selectQueue, resetQueue, makeChain } = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  function makeChain() {
    const node: Record<string, unknown> = {}
    node.from = () => node
    node.innerJoin = () => node
    node.where = () => node
    node.orderBy = () => node
    node.groupBy = () => node
    node.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject)
    return node
  }
  return {
    selectQueue,
    resetQueue: () => {
      selectQueue.length = 0
    },
    makeChain,
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => makeChain()),
    selectDistinctOn: vi.fn(() => makeChain()),
  },
}))

vi.mock('@/db/schema', () => ({
  patients: {
    id: 'id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    fullName: 'full_name',
    phone: 'phone',
    createdAt: 'created_at',
  },
  procedureRecords: {
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    performedAt: 'performed_at',
    procedureTypeId: 'procedure_type_id',
  },
  procedureTypes: {
    id: 'id',
    name: 'name',
  },
  financialEntries: {
    id: 'id',
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
  },
  installments: {
    financialEntryId: 'financial_entry_id',
    amount: 'amount',
    status: 'status',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  desc: (a: unknown) => ['desc', a],
}))

import { listInactivePatients } from '../inactive-patients'

function pushResults(patients: unknown[], lastProcedures: unknown[], lifetimeValues: unknown[]) {
  selectQueue.push(patients)
  selectQueue.push(lastProcedures)
  selectQueue.push(lifetimeValues)
}

describe('listInactivePatients', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    resetQueue()
    // Run on a UTC host, same as CI/Vercel — the whole point of the BR
    // helpers is to make this irrelevant to the outcome.
    process.env.TZ = 'UTC'
  })

  afterEach(() => {
    // `process.env.TZ = undefined` would set the literal string "undefined",
    // leaking an invalid TZ into every later test file in this worker.
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('excludes a patient whose last procedure lands exactly on the threshold day', async () => {
    // today = 2026-04-15 (BR). thresholdDays = 30 -> cutoff BR day = 2026-03-16.
    // A procedure performed anywhere within 2026-03-16 (BR) is exactly at the
    // threshold, not past it.
    pushResults(
      [
        {
          id: 'boundary',
          fullName: 'Boundary Patient',
          phone: '11999990000',
          createdAt: new Date('2020-01-01T12:00:00.000Z'),
        },
      ],
      [
        {
          patientId: 'boundary',
          performedAt: new Date('2026-03-16T14:00:00.000Z'), // 11:00 BR on the cutoff day
          procedureTypeName: 'Botox',
        },
      ],
      [],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toEqual([])
  })

  it('includes a patient whose last procedure is one BR day past the threshold', async () => {
    pushResults(
      [
        {
          id: 'past',
          fullName: 'Past Patient',
          phone: '11999990001',
          createdAt: new Date('2020-01-01T12:00:00.000Z'),
        },
      ],
      [
        {
          patientId: 'past',
          performedAt: new Date('2026-03-15T14:00:00.000Z'), // one BR day before cutoff
          procedureTypeName: 'Preenchimento',
        },
      ],
      [],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'past',
      fullName: 'Past Patient',
      lastProcedureAt: '2026-03-15',
      lastProcedureType: 'Preenchimento',
      daysSince: 31,
      lifetimeValue: 0,
    })
  })

  it('includes a never-treated patient created well before the threshold', async () => {
    pushResults(
      [
        {
          id: 'old-never',
          fullName: 'Old Never Treated',
          phone: '11888880000',
          createdAt: new Date('2020-01-01T12:00:00.000Z'),
        },
      ],
      [],
      [],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'old-never',
      lastProcedureAt: null,
      lastProcedureType: null,
      lifetimeValue: 0,
    })
    expect(rows[0].daysSince).toBeGreaterThan(30)
  })

  it('excludes a never-treated patient created yesterday', async () => {
    pushResults(
      [
        {
          id: 'new-never',
          fullName: 'New Never Treated',
          phone: '11888880001',
          createdAt: new Date('2026-04-14T14:00:00.000Z'), // yesterday, BR-local
        },
      ],
      [],
      [],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toEqual([])
  })

  it('orders results by lifetime value descending', async () => {
    const oldPerformedAt = new Date('2026-01-01T14:00:00.000Z')

    pushResults(
      [
        { id: 'low', fullName: 'Low Value', phone: '111', createdAt: new Date('2020-01-01T12:00:00Z') },
        { id: 'high', fullName: 'High Value', phone: '222', createdAt: new Date('2020-01-01T12:00:00Z') },
        { id: 'mid', fullName: 'Mid Value', phone: '333', createdAt: new Date('2020-01-01T12:00:00Z') },
      ],
      [
        { patientId: 'low', performedAt: oldPerformedAt, procedureTypeName: 'Type A' },
        { patientId: 'high', performedAt: oldPerformedAt, procedureTypeName: 'Type B' },
        { patientId: 'mid', performedAt: oldPerformedAt, procedureTypeName: 'Type C' },
      ],
      [
        { patientId: 'low', total: 350 },
        { patientId: 'high', total: 8000 },
        { patientId: 'mid', total: 1200 },
      ],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows.map((r) => r.patientId)).toEqual(['high', 'mid', 'low'])
    expect(rows.map((r) => r.lifetimeValue)).toEqual([8000, 1200, 350])
  })

  it('caps results at 200 rows', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `p${i}`,
      fullName: `Patient ${i}`,
      phone: '11999990000',
      createdAt: new Date('2020-01-01T12:00:00Z'),
    }))

    pushResults(many, [], [])

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toHaveLength(200)
  })

  it('never surfaces a soft-deleted patient even if old procedure/installment rows reference them', async () => {
    const oldPerformedAt = new Date('2026-01-01T14:00:00.000Z')

    // The patients query already filters deleted_at IS NULL, so a
    // soft-deleted patient never appears in the first result set — but
    // stale procedure/installment history for them may still exist.
    pushResults(
      [
        {
          id: 'active-1',
          fullName: 'Active Patient',
          phone: '11977770000',
          createdAt: new Date('2020-01-01T12:00:00Z'),
        },
      ],
      [
        { patientId: 'active-1', performedAt: oldPerformedAt, procedureTypeName: 'Type A' },
        { patientId: 'deleted-1', performedAt: oldPerformedAt, procedureTypeName: 'Type B' },
      ],
      [
        { patientId: 'active-1', total: 100 },
        { patientId: 'deleted-1', total: 9999 },
      ],
    )

    const rows = await listInactivePatients('tenant-1', {
      thresholdDays: 30,
      today: new Date('2026-04-15T10:00:00.000Z'),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].patientId).toBe('active-1')
    expect(rows.some((r) => r.patientId === 'deleted-1')).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// listDueFollowUps issues two independent selects (procedure records with a
// follow_up_date, and every tenant appointment) and joins/filters them in JS.
// We drive a fake `db` with a FIFO queue of results, one array per top-level
// `db.select(...)` call, in the exact order the module issues them: due
// records, then appointments. Every chain method (from/innerJoin/where) is a
// no-op that returns the same node; only awaiting the chain (its `.then`)
// shifts the queue, so call order, not resolution order, determines which
// canned result lands where. The window/status/date filtering happens in
// real code, not in the mock, so these tests exercise the actual business
// logic rather than trusting a SQL WHERE clause the mock ignores.
const { selectQueue, resetQueue, makeChain } = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  function makeChain() {
    const node: Record<string, unknown> = {}
    node.from = () => node
    node.innerJoin = () => node
    node.where = () => node
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
  },
}))

vi.mock('@/db/schema', () => ({
  patients: {
    id: 'id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    fullName: 'full_name',
    phone: 'phone',
  },
  procedureRecords: {
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    followUpDate: 'follow_up_date',
    procedureTypeId: 'procedure_type_id',
    performedAt: 'performed_at',
  },
  procedureTypes: {
    id: 'id',
    name: 'name',
  },
  appointments: {
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    status: 'status',
    date: 'date',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

import { listDueFollowUps } from '../due-followups'

function pushResults(dueRecords: unknown[], appointmentsRows: unknown[]) {
  selectQueue.push(dueRecords)
  selectQueue.push(appointmentsRows)
}

function record(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    patientId: 'p1',
    fullName: 'Patient One',
    phone: '11999990000',
    followUpDate: '2026-04-15',
    procedureTypeName: 'Botox',
    performedAt: new Date('2026-01-15T14:00:00.000Z'),
    ...overrides,
  }
}

describe('listDueFollowUps', () => {
  const originalTz = process.env.TZ
  // BR "today" = 2026-04-15. Ran on a UTC host, same as CI/Vercel, to make
  // sure the string-based comparisons hold regardless of host TZ.
  const today = new Date('2026-04-15T10:00:00.000Z')
  const windowDays = 7 // window end (BR) = 2026-04-22

  beforeEach(() => {
    resetQueue()
    process.env.TZ = 'UTC'
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('includes a follow-up due today, not flagged as overdue', async () => {
    pushResults([record({ followUpDate: '2026-04-15' })], [])

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'p1',
      followUpDate: '2026-04-15',
      daysUntil: 0,
      isOverdue: false,
    })
  })

  it('includes a follow-up due within the window', async () => {
    pushResults([record({ followUpDate: '2026-04-20' })], [])

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      followUpDate: '2026-04-20',
      daysUntil: 5,
      isOverdue: false,
    })
  })

  it('excludes a follow-up one day past the window', async () => {
    // window end (BR) = 2026-04-22; one day past = 2026-04-23.
    pushResults([record({ followUpDate: '2026-04-23' })], [])

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toEqual([])
  })

  it('includes and flags an overdue follow-up', async () => {
    pushResults([record({ followUpDate: '2026-04-10' })], [])

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      followUpDate: '2026-04-10',
      daysUntil: -5,
      isOverdue: true,
    })
  })

  it('excludes a patient who already has a future scheduled appointment', async () => {
    pushResults(
      [record({ followUpDate: '2026-04-16' })],
      [{ patientId: 'p1', status: 'scheduled', date: '2026-04-18' }],
    )

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toEqual([])
  })

  it('includes the same patient when their only appointment is in the past', async () => {
    pushResults(
      [record({ followUpDate: '2026-04-16' })],
      [{ patientId: 'p1', status: 'scheduled', date: '2026-04-01' }],
    )

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toHaveLength(1)
    expect(rows[0].patientId).toBe('p1')
  })

  it('does not exclude a patient whose future appointment is cancelled', async () => {
    pushResults(
      [record({ followUpDate: '2026-04-16' })],
      [{ patientId: 'p1', status: 'cancelled', date: '2026-04-18' }],
    )

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toHaveLength(1)
    expect(rows[0].patientId).toBe('p1')
  })

  it('carries the procedure type name and last performed date', async () => {
    pushResults(
      [
        record({
          followUpDate: '2026-04-15',
          procedureTypeName: 'Preenchimento',
          performedAt: new Date('2026-03-15T14:00:00.000Z'),
        }),
      ],
      [],
    )

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows[0]).toMatchObject({
      procedureTypeName: 'Preenchimento',
      lastProcedureAt: '2026-03-15',
    })
  })

  it('confirmed and in_progress statuses also count as already booked', async () => {
    pushResults(
      [record({ patientId: 'confirmed-1', followUpDate: '2026-04-16' }), record({ patientId: 'in-progress-1', followUpDate: '2026-04-16' })],
      [
        { patientId: 'confirmed-1', status: 'confirmed', date: '2026-04-20' },
        { patientId: 'in-progress-1', status: 'in_progress', date: '2026-04-16' },
      ],
    )

    const rows = await listDueFollowUps('tenant-1', { windowDays, today })

    expect(rows).toEqual([])
  })
})

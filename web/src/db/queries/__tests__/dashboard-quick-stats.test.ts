import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getQuickStats' branching logic (which month is queried, whether the
// week-scoped patient count is computed at all) is the risky part here.
// We stub drizzle-orm's operators as inert passthroughs and drive `db`
// with a small FIFO queue of results, one per `db.select(...).where(...)`
// call, in the exact order getQuickStats issues them. Boundary-day
// correctness (1st/31st/leap years) is covered separately in
// dashboard-month-boundaries.test.ts against the pure resolveMonthBoundaries
// function, since that's where the real date math lives.

const { selectQueue, resetQueue } = vi.hoisted(() => {
  const selectQueue: Array<Array<Record<string, unknown>>> = []
  return {
    selectQueue,
    resetQueue: () => {
      selectQueue.length = 0
    },
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    date: 'date',
    practitionerId: 'practitioner_id',
    patientId: 'patient_id',
  },
  patients: { fullName: 'full_name' },
  procedureTypes: { name: 'name' },
  procedureRecords: {
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    performedAt: 'performed_at',
    practitionerId: 'practitioner_id',
    followUpDate: 'follow_up_date',
    id: 'id',
    patientId: 'patient_id',
    procedureTypeId: 'procedure_type_id',
  },
  financialEntries: {},
  installments: {
    tenantId: 'tenant_id',
    status: 'status',
    paidAt: 'paid_at',
    amount: 'amount',
  },
  auditLogs: {},
  users: {},
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  ne: (a: unknown, b: unknown) => ['ne', a, b],
  isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lte: (a: unknown, b: unknown) => ['lte', a, b],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ['sql', strings, values],
  desc: (a: unknown) => ['desc', a],
  count: () => ['count'],
  sum: (a: unknown) => ['sum', a],
}))

import { getQuickStats } from '../dashboard'

describe('getQuickStats', () => {
  beforeEach(() => {
    resetQueue()
    vi.useFakeTimers()
    // BR: 2026-04-15 07:00 -03:00 — comfortably mid-April, current month.
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('with no month arg, matches the previous shape: week/procedures/revenue all populated for the current month', async () => {
    selectQueue.push([{ total: 4 }]) // patients this week
    selectQueue.push([{ total: 12 }]) // procedures this month
    selectQueue.push([{ total: '2500' }]) // revenue this month (pg sum comes back as a string)

    const result = await getQuickStats('tenant-1')

    expect(result).toEqual({
      patientsThisWeek: 4,
      proceduresThisMonth: 12,
      revenueThisMonth: 2500,
    })
  })

  it('passing the current month explicitly behaves the same as omitting it', async () => {
    selectQueue.push([{ total: 4 }])
    selectQueue.push([{ total: 12 }])
    selectQueue.push([{ total: '2500' }])

    const result = await getQuickStats('tenant-1', undefined, '2026-04')

    expect(result.patientsThisWeek).toBe(4)
  })

  it('an explicit past month scopes procedures/revenue to it and nulls out the week metric', async () => {
    selectQueue.push([{ total: 7 }]) // procedures (no patients-this-week call issued)
    selectQueue.push([{ total: '1000' }]) // revenue

    const result = await getQuickStats('tenant-1', undefined, '2026-02')

    expect(result).toEqual({
      patientsThisWeek: null,
      proceduresThisMonth: 7,
      revenueThisMonth: 1000,
    })
  })

  it('hides revenue for practitioners regardless of month (existing behaviour, unaffected)', async () => {
    selectQueue.push([{ total: 3 }]) // patients this week (current month, still runs)
    selectQueue.push([{ total: 5 }]) // procedures

    const result = await getQuickStats('tenant-1', 'practitioner-1')

    expect(result.revenueThisMonth).toBeNull()
  })

  it('rejects a future month', async () => {
    await expect(getQuickStats('tenant-1', undefined, '2026-05')).rejects.toThrow(/future/)
  })

  it('rejects a malformed month', async () => {
    await expect(getQuickStats('tenant-1', undefined, '2026/04')).rejects.toThrow()
  })

  it('defaults missing totals to zero', async () => {
    selectQueue.push([]) // patients this week: no rows
    selectQueue.push([]) // procedures: no rows
    selectQueue.push([]) // revenue: no rows

    const result = await getQuickStats('tenant-1')

    expect(result).toEqual({
      patientsThisWeek: 0,
      proceduresThisMonth: 0,
      revenueThisMonth: 0,
    })
  })
})

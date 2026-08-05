import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// listRepeatNoShows issues a single select (appointments joined to patients
// and procedure types) and does all the counting/window/status logic in JS.
// We drive a fake `db` with a FIFO queue of results, one array per
// `db.select(...)` call. Every chain method (from/innerJoin/leftJoin/where)
// is a no-op that returns the same node; only awaiting the chain (its
// `.then`) shifts the queue. The window/status/minCount filtering happens in
// real code, not in the mock, so these tests exercise the actual business
// logic rather than trusting a SQL WHERE clause the mock ignores.
const { selectQueue, resetQueue, makeChain } = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  function makeChain() {
    const node: Record<string, unknown> = {}
    node.from = () => node
    node.innerJoin = () => node
    node.leftJoin = () => node
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
  appointments: {
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    status: 'status',
    date: 'date',
    procedureTypeId: 'procedure_type_id',
  },
  procedureTypes: {
    id: 'id',
    defaultPrice: 'default_price',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
}))

import { listRepeatNoShows } from '../repeat-no-shows'

function pushResults(rows: unknown[]) {
  selectQueue.push(rows)
}

function occurrence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    patientId: 'p1',
    fullName: 'Patient One',
    phone: '11999990000',
    status: 'no_show',
    date: '2026-04-15',
    defaultPrice: null,
    ...overrides,
  }
}

describe('listRepeatNoShows', () => {
  const originalTz = process.env.TZ
  // BR "today" = 2026-04-15. Ran on a UTC host, same as CI/Vercel, to make
  // sure the string-based comparisons hold regardless of host TZ.
  const today = new Date('2026-04-15T10:00:00.000Z')
  const windowDays = 10 // window start (BR, inclusive) = 2026-04-05

  beforeEach(() => {
    resetQueue()
    process.env.TZ = 'UTC'
  })

  afterEach(() => {
    // `process.env.TZ = undefined` would set the literal string "undefined",
    // leaking an invalid TZ into every later test file in this worker.
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('excludes a patient with exactly minCount - 1 occurrences', async () => {
    pushResults([occurrence({ date: '2026-04-10' })])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows).toEqual([])
  })

  it('includes a patient with exactly minCount occurrences', async () => {
    pushResults([
      occurrence({ date: '2026-04-10' }),
      occurrence({ date: '2026-04-12' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'p1',
      missedCount: 2,
    })
    expect(rows[0].dates.sort()).toEqual(['2026-04-10', '2026-04-12'])
  })

  it('does not count an occurrence that falls one day outside the window', async () => {
    // window start (BR, inclusive) = 2026-04-05; one day before = 2026-04-04.
    pushResults([
      occurrence({ date: '2026-04-05' }), // on the boundary: counted
      occurrence({ date: '2026-04-04' }), // one day outside: not counted
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 1, today })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'p1',
      missedCount: 1,
      dates: ['2026-04-05'],
    })
  })

  it('counts both no_show and cancelled statuses', async () => {
    pushResults([
      occurrence({ date: '2026-04-10', status: 'no_show' }),
      occurrence({ date: '2026-04-12', status: 'cancelled' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows).toHaveLength(1)
    expect(rows[0].missedCount).toBe(2)
  })

  it('sums missedValue from the procedure type price', async () => {
    pushResults([
      occurrence({ date: '2026-04-10', defaultPrice: '100.00' }),
      occurrence({ date: '2026-04-12', defaultPrice: '50.00' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows[0].missedValue).toBe(150)
  })

  it('treats a null procedure type price as 0 rather than NaN', async () => {
    pushResults([
      occurrence({ date: '2026-04-10', defaultPrice: null }),
      occurrence({ date: '2026-04-12', defaultPrice: '75.00' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows[0].missedValue).toBe(75)
    expect(rows[0].missedValue).not.toBeNaN()
  })

  it('does not count a future-dated cancellation, and it does not contribute to missedValue', async () => {
    // today = 2026-04-15 (BR); a cancellation dated next month has not
    // happened yet and must not be treated as a miss.
    pushResults([
      occurrence({ date: '2026-04-20', status: 'cancelled', defaultPrice: '900.00' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 1, today })

    expect(rows).toEqual([])
  })

  it('still counts a cancellation dated today (the upper bound is inclusive)', async () => {
    pushResults([occurrence({ date: '2026-04-15', status: 'cancelled', defaultPrice: '100.00' })])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 1, today })

    expect(rows).toHaveLength(1)
    expect(rows[0].missedValue).toBe(100)
  })

  it('caps results at 200 rows', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      occurrence({ patientId: `p${i}`, fullName: `Patient ${i}`, date: '2026-04-10' }),
    )
    pushResults(many)

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 1, today })

    expect(rows).toHaveLength(200)
  })

  it('orders by missed count descending, then missed value descending', async () => {
    pushResults([
      // low: 2 occurrences, low value
      occurrence({ patientId: 'low', fullName: 'Low', date: '2026-04-10', defaultPrice: '50.00' }),
      occurrence({ patientId: 'low', fullName: 'Low', date: '2026-04-11', defaultPrice: '50.00' }),
      // high-count: 3 occurrences
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-10', defaultPrice: '10.00' }),
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-11', defaultPrice: '10.00' }),
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-12', defaultPrice: '10.00' }),
      // high-value: 2 occurrences, higher value than "low"
      occurrence({ patientId: 'high-value', fullName: 'High Value', date: '2026-04-10', defaultPrice: '500.00' }),
      occurrence({ patientId: 'high-value', fullName: 'High Value', date: '2026-04-11', defaultPrice: '500.00' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', { windowDays, minCount: 2, today })

    expect(rows.map((r) => r.patientId)).toEqual(['high-count', 'high-value', 'low'])
  })

  it('applies an explicit sort by missedValue, overriding the default (count-first) order', async () => {
    pushResults([
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-10', defaultPrice: '10.00' }),
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-11', defaultPrice: '10.00' }),
      occurrence({ patientId: 'high-count', fullName: 'High Count', date: '2026-04-12', defaultPrice: '10.00' }),
      occurrence({ patientId: 'high-value', fullName: 'High Value', date: '2026-04-10', defaultPrice: '500.00' }),
      occurrence({ patientId: 'high-value', fullName: 'High Value', date: '2026-04-11', defaultPrice: '500.00' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', {
      windowDays,
      minCount: 2,
      today,
      sort: { key: 'missedValue', dir: 'desc' },
    })

    // Default order puts high-count first (more occurrences); explicit
    // sort by missedValue puts high-value first instead.
    expect(rows.map((r) => r.patientId)).toEqual(['high-value', 'high-count'])
  })

  it('sorts by fullName when requested', async () => {
    pushResults([
      occurrence({ patientId: 'z', fullName: 'Zoe Almeida', date: '2026-04-10' }),
      occurrence({ patientId: 'z', fullName: 'Zoe Almeida', date: '2026-04-11' }),
      occurrence({ patientId: 'a', fullName: 'Ana Souza', date: '2026-04-10' }),
      occurrence({ patientId: 'a', fullName: 'Ana Souza', date: '2026-04-11' }),
    ])

    const rows = await listRepeatNoShows('tenant-1', {
      windowDays,
      minCount: 2,
      today,
      sort: { key: 'fullName', dir: 'asc' },
    })

    expect(rows.map((r) => r.patientId)).toEqual(['a', 'z'])
  })
})

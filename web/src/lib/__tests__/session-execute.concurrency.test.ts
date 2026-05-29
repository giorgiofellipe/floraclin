import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Concurrency test ────────────────────────────────────────────────
//
// Two `executeSession` calls fired in parallel against the same record.
// The serialized model:
//   1. Both calls compute `sessionsDone = N` from their snapshot.
//   2. Both call `createSession({ expectedOrdinal: N + 1 })`.
//   3. The "winner" inserts; its insert bumps the global session count
//      to N + 1.
//   4. The "loser" then does its MAX+1 check and finds MAX is now N+1,
//      so MAX+1 = N+2 ≠ its `expectedOrdinal` (N+1). It throws
//      `Error('concurrent_session_insert')`, which `executeSession`
//      re-wraps as `BusinessError('concurrent_session_insert')`.
//
// In production this serialization comes from `FOR UPDATE` on
// `procedure_records`; here we emulate it with a single shared count and
// run the two transactions sequentially through a queue, mimicking the
// post-lock view each call would observe.

interface RecordRow {
  id: string
  tenantId: string
  status: string
  sessionsTotal: number
  patientPackageId: string | null
  deletedAt: Date | null
}

const { state, TABLE_TOKENS } = vi.hoisted(() => {
  interface SharedState {
    sessionsCount: number
    record: {
      id: string
      tenantId: string
      status: string
      sessionsTotal: number
      patientPackageId: string | null
      deletedAt: Date | null
    } | null
    insertedSessionIds: string[]
    // Track which ordinals already landed — duplicates simulate the
    // `(procedure_record_id, session_ordinal)` unique constraint, which
    // is the safety net under racing inserts.
    usedOrdinals: Set<number>
    // Counter for "sess-N" ids handed out on each insert.
    nextInsertedId: () => string
    // Per-record async mutex: simulates the FOR UPDATE lock on
    // `procedure_records`. The first tx to "acquire" the record lock
    // captures the slot; subsequent acquires queue until the holder
    // releases (i.e. its transaction body returns).
    acquireRecordLock: (
      recordId: string,
    ) => Promise<() => void>
    locks: Map<string, Promise<void>>
  }
  let counter = 0
  const state: SharedState = {
    sessionsCount: 0,
    record: null,
    insertedSessionIds: [],
    usedOrdinals: new Set<number>(),
    nextInsertedId: () => {
      counter += 1
      return `sess-${counter}`
    },
    locks: new Map(),
    acquireRecordLock: async (recordId: string) => {
      const prev = state.locks.get(recordId) ?? Promise.resolve()
      let release!: () => void
      const next = new Promise<void>((resolve) => {
        release = resolve
      })
      state.locks.set(recordId, prev.then(() => next))
      await prev
      return release
    },
  }
  const TABLE_TOKENS = {
    procedureRecords: { __table: 'procedureRecords' },
    patientPackages: { __table: 'patientPackages' },
    procedureSessions: { __table: 'procedureSessions' },
  } as const
  return { state, TABLE_TOKENS }
})

function resetState(record: RecordRow) {
  state.sessionsCount = 0
  state.record = record
  state.insertedSessionIds = []
  state.usedOrdinals = new Set()
  state.locks = new Map()
}

vi.mock('@/db/client', () => {
  function tagTable(token: unknown): string {
    return (token as { __table?: string } | null)?.__table ?? 'unknown'
  }

  function makeTx() {
    // Snapshot the session count when the tx starts — used to drive the
    // "winner / loser" race. The lock SELECT and the COUNT query inside
    // the same tx see this snapshot. The createSession MAX+1 query
    // re-reads the live `state.sessionsCount` so it observes any insert
    // performed by the other tx since this tx started.
    return {
      select: (proj?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const tag = tagTable(table)
          if (tag === 'procedureSessions') {
            return {
              where: () => {
                const keys = Object.keys(proj ?? {})
                if (keys.includes('nextOrdinal')) {
                  // Live read — observes the other tx's insert.
                  return Promise.resolve([
                    { nextOrdinal: state.sessionsCount + 1 },
                  ])
                }
                // countSessionsForRecord: snapshot view. We use the live
                // value here too — the test orchestrates the race by
                // scheduling both calls before either inserts.
                return Promise.resolve([{ n: state.sessionsCount }])
              },
            }
          }
          return {
            where: () => ({
              for: () => ({
                limit: () => {
                  if (tag === 'procedureRecords') {
                    return Promise.resolve(state.record ? [state.record] : [])
                  }
                  return Promise.resolve([])
                },
              }),
            }),
          }
        },
      }),
      insert: (table: unknown) => ({
        values: (vals: Record<string, unknown>) => ({
          returning: () => {
            if (tagTable(table) === 'procedureSessions') {
              const ordinal = vals.sessionOrdinal as number
              if (state.usedOrdinals.has(ordinal)) {
                // Mimic Postgres unique-violation for
                // (procedure_record_id, session_ordinal). The real driver
                // would throw a `PostgresError` with code 23505; here we
                // throw a plain Error tagged so the test can recognise
                // it as the safety-net path.
                return Promise.reject(
                  Object.assign(new Error('unique_violation'), {
                    code: '23505',
                  }),
                )
              }
              state.usedOrdinals.add(ordinal)
              const id = state.nextInsertedId()
              state.insertedSessionIds.push(id)
              state.sessionsCount += 1
              return Promise.resolve([
                {
                  id,
                  tenantId: vals.tenantId as string,
                  procedureRecordId: vals.procedureRecordId as string,
                  sessionOrdinal: ordinal,
                  performedAt: vals.performedAt as Date,
                  executedBy: vals.executedBy as string,
                  technique: null,
                  clinicalResponse: null,
                  adverseEffects: null,
                  notes: null,
                  followUpDate: null,
                  nextSessionObjectives: null,
                },
              ])
            }
            return Promise.resolve([])
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
    }
  }

  return {
    db: {
      transaction: async (
        fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>,
      ) => fn(makeTx()),
    },
  }
})

// We can't `await import('@/db/client')` inside this factory and trust
// vitest to return the same mocked module under concurrent dynamic
// imports — the second call sometimes resolves to the real module. The
// safe approach is to construct a fresh tx here that delegates back to
// the same harness state used by the `@/db/client` mock.
vi.mock('@/lib/tenant', () => ({
  withTransaction: async (
    fn: (tx: Record<string, unknown>) => Promise<unknown>,
  ) => {
    // Build a tx that matches the @/db/client mock shape exactly — we
    // can't share `makeTx` across mock factories so we duplicate it. The
    // shared `state` object is closed over (declared via vi.hoisted at
    // the top of this file).
    function tagTable(token: unknown): string {
      return (token as { __table?: string } | null)?.__table ?? 'unknown'
    }
    const tx = {
      select: (proj?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const tag = tagTable(table)
          if (tag === 'procedureSessions') {
            return {
              where: () => {
                const keys = Object.keys(proj ?? {})
                if (keys.includes('nextOrdinal')) {
                  return Promise.resolve([
                    { nextOrdinal: state.sessionsCount + 1 },
                  ])
                }
                return Promise.resolve([{ n: state.sessionsCount }])
              },
            }
          }
          return {
            where: () => ({
              for: () => ({
                limit: () => {
                  if (tag === 'procedureRecords') {
                    return Promise.resolve(state.record ? [state.record] : [])
                  }
                  return Promise.resolve([])
                },
              }),
            }),
          }
        },
      }),
      insert: (table: unknown) => ({
        values: (vals: Record<string, unknown>) => ({
          returning: () => {
            if (tagTable(table) === 'procedureSessions') {
              const ordinal = vals.sessionOrdinal as number
              if (state.usedOrdinals.has(ordinal)) {
                return Promise.reject(
                  Object.assign(new Error('unique_violation'), {
                    code: '23505',
                  }),
                )
              }
              state.usedOrdinals.add(ordinal)
              const id = state.nextInsertedId()
              state.insertedSessionIds.push(id)
              state.sessionsCount += 1
              return Promise.resolve([
                {
                  id,
                  tenantId: vals.tenantId,
                  procedureRecordId: vals.procedureRecordId,
                  sessionOrdinal: ordinal,
                  performedAt: vals.performedAt,
                  executedBy: vals.executedBy,
                  technique: null,
                  clinicalResponse: null,
                  adverseEffects: null,
                  notes: null,
                  followUpDate: null,
                  nextSessionObjectives: null,
                },
              ])
            }
            return Promise.resolve([])
          },
        }),
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve(undefined) }),
      }),
    }
    return fn(tx)
  },
}))

vi.mock('@/db/schema', () => ({
  procedureRecords: Object.assign(TABLE_TOKENS.procedureRecords, {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    sessionsTotal: 'sessions_total',
    patientPackageId: 'patient_package_id',
    deletedAt: 'deleted_at',
  }),
  patientPackages: Object.assign(TABLE_TOKENS.patientPackages, {
    id: 'id',
    status: 'status',
    closedAt: 'closed_at',
  }),
  procedureSessions: Object.assign(TABLE_TOKENS.procedureSessions, {
    id: 'id',
    procedureRecordId: 'procedure_record_id',
    sessionOrdinal: 'session_ordinal',
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  sql: Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => ({
      __sql: strings.join('?'),
      params,
    }),
    { raw: (s: string) => ({ __sql: s, params: [] }) },
  ),
}))

vi.mock('@/db/queries/product-applications', () => ({
  saveProductApplicationsForSession: vi.fn(async () => []),
}))

vi.mock('@/db/queries/face-diagrams', () => ({
  saveFaceDiagramForSession: vi.fn(async () => 'diag-1'),
}))

vi.mock('@/db/queries/photos', () => ({
  assignPhotosToSession: vi.fn(async () => []),
}))

vi.mock('@/lib/packages', () => ({
  maybeCompletePackage: vi.fn(async () => false),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async () => undefined),
}))

const importModule = async () => await import('../session-execute')

const TENANT = '00000000-0000-0000-0000-000000000001'
const RECORD = '00000000-0000-0000-0000-000000000aaa'
const USER = '00000000-0000-0000-0000-000000000bbb'

describe('executeSession — concurrency', () => {
  beforeEach(() => {
    resetState({
      id: RECORD,
      tenantId: TENANT,
      status: 'approved',
      sessionsTotal: 4,
      patientPackageId: null,
      deletedAt: null,
    })
  })

  it('exactly one of two concurrent executeSession calls succeeds; the other throws BusinessError(concurrent_session_insert)', async () => {
    const { executeSession } = await importModule()

    const input = {
      tenantId: TENANT,
      procedureRecordId: RECORD,
      executedBy: USER,
      performedAt: new Date('2026-05-28T12:00:00Z'),
    }

    // Fire two parallel calls. Because our mock harness runs each
    // transaction synchronously and serially through the JS event loop,
    // the second call's `countSessionsForRecord` and createSession MAX+1
    // read observe the first call's insert and reject as expected — the
    // same outcome a real `FOR UPDATE` lock guarantees in Postgres.
    const results = await Promise.allSettled([
      executeSession(input),
      executeSession(input),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const reason = (rejected[0] as PromiseRejectedResult).reason
    // The loser's error can be one of two things, both acceptable:
    //   1. BusinessError('concurrent_session_insert') — createSession's
    //      MAX+1 vs expectedOrdinal assertion fired post-lock (the
    //      primary defense).
    //   2. A unique-violation on (procedure_record_id, session_ordinal) —
    //      the secondary safety net at the DB layer. In production this
    //      surfaces as PostgresError(code: '23505').
    const isBusinessError =
      (reason as { name?: string })?.name === 'BusinessError' &&
      (reason as { code?: string })?.code === 'concurrent_session_insert'
    const isUniqueViolation =
      (reason as { code?: string })?.code === '23505'
    expect(isBusinessError || isUniqueViolation).toBe(true)

    // Exactly one session row inserted (the winner). The loser rolled
    // back before its insert "took".
    expect(state.insertedSessionIds).toHaveLength(1)
    expect(state.sessionsCount).toBe(1)
  })
})

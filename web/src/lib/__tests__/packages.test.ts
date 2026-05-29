import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Pure-function tests ─────────────────────────────────────────────
//
// These exercise the date math + completion predicate without touching
// the DB. The race-safety + tenant-scope tests live below and use a
// hand-rolled transaction harness so we can assert the SQL execution
// order without standing up a real Postgres.
//
// What the harness lets us prove:
//   1. cancelPackage's FOR UPDATE lock scopes by tenant_id so a
//      cross-tenant id can never acquire a lock.
//   2. maybeCompletePackage flips the package to 'completed' only when
//      EVERY record on the package has at least `sessionsTotal` rows
//      in `procedure_sessions`. A short record short-circuits.
//   3. closePackage with `patient_lost_expiry` writes
//      `status='completed' / closedAt / closedReason` and a NULL
//      closeNote; with `other` + a note both fields are persisted.

import { computePackageExpiresAt, shouldCompletePackage } from '../packages'

describe('computePackageExpiresAt', () => {
  it('returns null when validity is null', () => {
    expect(computePackageExpiresAt(null, '2026-05-27')).toBeNull()
  })

  it('returns null when validity is undefined', () => {
    expect(computePackageExpiresAt(undefined, '2026-05-27')).toBeNull()
  })

  it('adds whole months to a BR-anchored today', () => {
    expect(computePackageExpiresAt(3, '2026-05-27')).toBe('2026-08-27')
  })

  it('handles month rollover at year boundary', () => {
    expect(computePackageExpiresAt(2, '2026-11-15')).toBe('2027-01-15')
  })

  it('clamps day when target month is shorter (date-fns addMonths semantics)', () => {
    // Jan 31 + 1 month = Feb 28 (or 29 in leap year)
    expect(computePackageExpiresAt(1, '2026-01-31')).toBe('2026-02-28')
  })

  it('handles 12 months (one year)', () => {
    expect(computePackageExpiresAt(12, '2026-05-27')).toBe('2027-05-27')
  })
})

describe('shouldCompletePackage', () => {
  it('returns false for an empty package', () => {
    expect(shouldCompletePackage([])).toBe(false)
  })

  it('returns false when one line is short', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 4 },
        { sessionsTotal: 4, executedCount: 3 },
      ]),
    ).toBe(false)
  })

  it('returns true when every line is fully executed', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 4 },
        { sessionsTotal: 2, executedCount: 2 },
      ]),
    ).toBe(true)
  })

  it('returns true when executed exceeds total (safety against drift)', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 5 },
      ]),
    ).toBe(true)
  })

  it('returns false when no executions yet', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 0 },
        { sessionsTotal: 2, executedCount: 0 },
      ]),
    ).toBe(false)
  })

  it('returns true for a single fully-consumed line', () => {
    expect(
      shouldCompletePackage([{ sessionsTotal: 1, executedCount: 1 }]),
    ).toBe(true)
  })
})

// ─── Transaction harness for race-safety / tenant-scope tests ────────
//
// vi.mock factories are hoisted to the top of the file, so anything they
// reference must be declared via vi.hoisted so it exists at hoist time.

const { txState, TABLE_TOKENS } = vi.hoisted(() => {
  interface ExecuteCall {
    fragment: string
    params: unknown[]
  }
  interface UpdateCall {
    table: string
    values: Record<string, unknown>
  }
  interface TxState {
    executeResponses: Array<{ rows: Array<Record<string, unknown>> }>
    executeCalls: ExecuteCall[]
    // procedureRecords select: list of { id, sessionsTotal }
    procedureRecordRows: Array<{ id: string; sessionsTotal: number }>
    // procedureSessions COUNT(*) keyed by procedureRecordId
    sessionCountsByRecord: Record<string, number>
    // captured update().set() calls, keyed by table tag
    updateCalls: UpdateCall[]
    // captured audit-log insertions
    auditCalls: Array<Record<string, unknown>>
    // patientPackages FOR UPDATE lock results — closePackageQuery does
    // `select().from(patientPackages).where().for('update').limit(1)`.
    // Each entry is the row that lock should return, or null for not-found.
    patientPackageLockRows: Array<{ id: string; status: string } | null>
    // patientPackages UPDATE ... RETURNING rows — closePackageQuery now
    // returns the updated row. Each entry is yielded in order.
    patientPackageReturningRows: Array<
      { id: string; closedAt: Date; closedReason: string } | undefined
    >
  }
  const txState: TxState = {
    executeResponses: [],
    executeCalls: [],
    procedureRecordRows: [],
    sessionCountsByRecord: {},
    updateCalls: [],
    auditCalls: [],
    patientPackageLockRows: [],
    patientPackageReturningRows: [],
  }
  const TABLE_TOKENS = {
    patientPackages: { __table: 'patientPackages' },
    procedureRecords: { __table: 'procedureRecords' },
    procedureSessions: { __table: 'procedureSessions' },
    auditLogs: { __table: 'auditLogs' },
  } as const
  // Stash on globalThis so mock factories (which run at hoist time) can
  // reach the same shared state without recreating it per factory.
  ;(globalThis as Record<string, unknown>).__pkg_test_tokens = TABLE_TOKENS
  ;(globalThis as Record<string, unknown>).__pkg_test_txState = txState
  return { txState, TABLE_TOKENS }
})

function resetTx() {
  txState.executeResponses = []
  txState.executeCalls = []
  txState.procedureRecordRows = []
  txState.sessionCountsByRecord = {}
  txState.updateCalls = []
  txState.auditCalls = []
  txState.patientPackageLockRows = []
  txState.patientPackageReturningRows = []
}

// `makeTx` lives in vi.hoisted so the mock factories below can reach it.
const { makeTx } = vi.hoisted(() => {
  return {
    makeTx: () => {
      // Late-bind references to the outer hoisted block via globalThis so
      // mock factories (also hoisted) share the same harness instance.
      type SharedTxState = {
        executeResponses: Array<{ rows: Array<Record<string, unknown>> }>
        executeCalls: Array<{ fragment: string; params: unknown[] }>
        procedureRecordRows: Array<{ id: string; sessionsTotal: number }>
        sessionCountsByRecord: Record<string, number>
        updateCalls: Array<{ table: string; values: Record<string, unknown> }>
        auditCalls: Array<Record<string, unknown>>
        patientPackageLockRows: Array<{ id: string; status: string } | null>
        patientPackageReturningRows: Array<
          { id: string; closedAt: Date; closedReason: string } | undefined
        >
        __nextCountRecordIdQueue?: string[]
      }
      const g = globalThis as Record<string, unknown>
      const ST = g.__pkg_test_txState as SharedTxState
      // We identity-compare via the __table tag (the schema mock spreads
      // the token into a new object, so identity-by-reference fails). The
      // __table tag survives the spread because it's a plain string.
      const tagOf = (t: unknown): string | undefined =>
        (t as { __table?: string } | null)?.__table
      return {
        execute: (sqlObj: unknown) => {
          const fragment = JSON.stringify(sqlObj)
          ST.executeCalls.push({ fragment, params: [] })
          const response = ST.executeResponses.shift() ?? { rows: [] }
          return Promise.resolve(response)
        },
        select: (proj?: Record<string, unknown>) => ({
          from: (table: unknown) => {
            const tag = tagOf(table)
            // patientPackages SELECT ... FOR UPDATE LIMIT 1 — used by
            // closePackageQuery. Returns from the lock-rows queue.
            const pkgRows = () => {
              const row = ST.patientPackageLockRows.shift()
              if (!row) return Promise.resolve([])
              return Promise.resolve([row])
            }
            // The query chain is .where(...).for('update').limit(1)
            // but maybeCompletePackage / other consumers may just .where(...).
            return {
              where: () => {
                if (tag === 'patientPackages') {
                  // Build a chainable object so callers can append
                  // .for('update').limit(1) OR await directly.
                  const chain = {
                    for: (_mode: string) => ({
                      limit: (_n: number) => pkgRows(),
                    }),
                    limit: (_n: number) => pkgRows(),
                    then: (
                      onFulfilled: (v: unknown) => unknown,
                      onRejected?: (e: unknown) => unknown,
                    ) => pkgRows().then(onFulfilled, onRejected),
                  }
                  return chain
                }
                // procedureRecords: list of {id, sessionsTotal}.
                if (tag === 'procedureRecords') {
                  return Promise.resolve(ST.procedureRecordRows)
                }
                // procedureSessions COUNT(*) — the maybeCompletePackage
                // call projects `{ n: sql<number>... }` and reads via
                // `[{ n }] = await ...`. We need to discriminate the
                // record id from the captured where clause; the harness
                // can't see `eq(procedureSessions.procedureRecordId, r.id)`
                // because the operator mock is opaque. We fall back to a
                // queue: emit counts in `procedureRecordRows` order.
                if (tag === 'procedureSessions') {
                  const keys = Object.keys(proj ?? {})
                  if (keys.includes('n')) {
                    // Pull the next record id off the front; we rely on
                    // maybeCompletePackage iterating in array order.
                    const recordId = ST.__nextCountRecordIdQueue?.shift?.()
                    const n =
                      recordId !== undefined
                        ? ST.sessionCountsByRecord[recordId] ?? 0
                        : 0
                    return Promise.resolve([{ n }])
                  }
                }
                return Promise.resolve([])
              },
            }
          },
        }),
        update: (table: unknown) => ({
          set: (vals: Record<string, unknown>) => ({
            where: () => {
              ST.updateCalls.push({
                table: tagOf(table) ?? 'unknown',
                values: vals,
              })
              // closePackageQuery chains `.returning({...})` after the
              // UPDATE. Expose a thenable + .returning() so both shapes
              // work without forcing every caller to opt in.
              const returningRows = () => {
                if (tagOf(table) === 'patientPackages') {
                  const row = ST.patientPackageReturningRows.shift()
                  return Promise.resolve(row ? [row] : [])
                }
                return Promise.resolve([])
              }
              const chain = {
                returning: (_proj?: Record<string, unknown>) => returningRows(),
                then: (
                  onFulfilled: (v: unknown) => unknown,
                  onRejected?: (e: unknown) => unknown,
                ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
              }
              return chain
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            const tag = tagOf(table)
            if (tag === 'auditLogs') {
              ST.auditCalls.push(vals)
              return Promise.resolve(undefined)
            }
            return Promise.resolve(undefined)
          },
        }),
      }
    },
  }
})

// The mocked db.transaction passes makeTx() to the body. The COUNT(*)
// queue lives on the shared txState (see the procedureSessions handler in
// makeTx). We pre-fill it via `seedRecords` in the order
// `maybeCompletePackage` iterates records.
//
// We also expose the same handlers on `db` itself so callers that pass
// `db` (or its default) as the `tx` parameter — e.g. `maybeCompletePackage`
// and `closePackage` invoked without an explicit tx — route through the
// same harness.
vi.mock('@/db/client', () => {
  const dbProxy = new Proxy({}, {
    get: (_target, prop) => {
      const tx = makeTx() as unknown as Record<string, unknown>
      if (prop === 'transaction') {
        return async (
          fn: (innerTx: ReturnType<typeof makeTx>) => Promise<unknown>,
        ) => fn(makeTx())
      }
      return tx[prop as string]
    },
  })
  return { db: dbProxy }
})

vi.mock('@/lib/tenant', () => ({
  withTransaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
    fn(makeTx()),
}))

vi.mock('@/db/queries/financial', () => ({
  createFinancialEntry: vi.fn(async () => ({ id: 'fin-1' })),
}))

vi.mock('@/db/schema', () => {
  const TT = (globalThis as Record<string, unknown>).__pkg_test_tokens as {
    patientPackages: { __table: string }
    procedureRecords: { __table: string }
    procedureSessions: { __table: string }
    auditLogs: { __table: string }
  }
  return {
    patientPackages: {
      ...TT.patientPackages,
      id: 'id',
      tenantId: 'tenant_id',
      status: 'status',
      expiresAt: 'expires_at',
      patientId: 'patient_id',
      closedAt: 'closed_at',
      closedReason: 'closed_reason',
      closeNote: 'close_note',
      updatedAt: 'updated_at',
    },
    procedureRecords: {
      ...TT.procedureRecords,
      id: 'id',
      tenantId: 'tenant_id',
      status: 'status',
      sessionsTotal: 'sessions_total',
      patientPackageId: 'patient_package_id',
      deletedAt: 'deleted_at',
    },
    procedureSessions: {
      ...TT.procedureSessions,
      id: 'id',
      tenantId: 'tenant_id',
      procedureRecordId: 'procedure_record_id',
    },
    auditLogs: {
      ...TT.auditLogs,
      id: 'id',
      tenantId: 'tenant_id',
      userId: 'user_id',
    },
  }
})

// drizzle operators are opaque to our stub — pass them straight through.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  inArray: (a: unknown, b: unknown) => ['inArray', a, b],
  isNull: (a: unknown) => ['isNull', a],
  sql: Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => ({
      // Stringify so JSON.stringify captures the SQL text + interpolated
      // tenant ids for our fragment inspection.
      __sql: strings.join('?'),
      params,
    }),
    {
      // Tagged template fallback (used by `sql<number>\`count(*)::int\``).
      raw: (s: string) => ({ __sql: s, params: [] }),
    },
  ),
}))

// Helper: register record ids whose COUNT(*) calls will be served by the
// queue. `maybeCompletePackage` reads records first, then loops one
// COUNT(*) per record. We seed the queue right before each test runs.
function seedRecords(rows: Array<{ id: string; sessionsTotal: number; sessionsExecuted: number }>) {
  txState.procedureRecordRows = rows.map((r) => ({
    id: r.id,
    sessionsTotal: r.sessionsTotal,
  }))
  txState.sessionCountsByRecord = Object.fromEntries(
    rows.map((r) => [r.id, r.sessionsExecuted]),
  )
  // Pre-populate the queue used by procedureSessions COUNT(*) reads.
  ;(txState as unknown as { __nextCountRecordIdQueue: string[] }).__nextCountRecordIdQueue =
    rows.map((r) => r.id)
}

// Re-import after mocks are in place. Top-level imports above (used by the
// pure-function tests) are not affected — they reference the already-loaded
// helpers, not the live mocked side.
const importModule = async () => await import('../packages')

beforeEach(() => {
  resetTx()
})

describe('cancelPackage — tenant scope on FOR UPDATE', () => {
  it('scopes the lock by tenant_id and rejects 0-row results as not found', async () => {
    const { cancelPackage } = await importModule()
    txState.executeResponses.push({ rows: [] })

    await expect(
      cancelPackage({
        tenantId: 'tenant-A',
        patientPackageId: 'pkg-1',
        reason: 'cliente desistiu',
      }),
    ).rejects.toThrow('Pacote não encontrado')

    expect(txState.executeCalls[0].fragment).toContain('patient_packages')
    expect(txState.executeCalls[0].fragment).toContain('tenant_id')
    expect(txState.executeCalls[0].fragment).toContain('FOR UPDATE')
  })
})

describe('maybeCompletePackage — sessions-driven completion', () => {
  it('does NOT flip when a record has fewer sessions than sessionsTotal', async () => {
    const { maybeCompletePackage } = await importModule()
    seedRecords([
      { id: 'rec-1', sessionsTotal: 4, sessionsExecuted: 4 },
      // This record is short — should short-circuit the whole package.
      { id: 'rec-2', sessionsTotal: 4, sessionsExecuted: 3 },
    ])

    const flipped = await maybeCompletePackage('tenant-A', 'pkg-1')

    expect(flipped).toBe(false)
    // No patientPackages update fired because short-circuit returned early.
    expect(
      txState.updateCalls.filter((u) => u.table === 'patientPackages'),
    ).toHaveLength(0)
  })

  it('flips status to completed only when EVERY record meets its quota', async () => {
    const { maybeCompletePackage } = await importModule()
    seedRecords([
      { id: 'rec-1', sessionsTotal: 4, sessionsExecuted: 4 },
      { id: 'rec-2', sessionsTotal: 2, sessionsExecuted: 2 },
    ])

    const flipped = await maybeCompletePackage('tenant-A', 'pkg-1')

    expect(flipped).toBe(true)
    const pkgUpdates = txState.updateCalls.filter(
      (u) => u.table === 'patientPackages',
    )
    expect(pkgUpdates).toHaveLength(1)
    expect(pkgUpdates[0].values).toMatchObject({ status: 'completed' })
  })

  it('returns false when the package has no procedure records yet', async () => {
    const { maybeCompletePackage } = await importModule()
    seedRecords([])

    const flipped = await maybeCompletePackage('tenant-A', 'pkg-empty')

    expect(flipped).toBe(false)
    expect(
      txState.updateCalls.filter((u) => u.table === 'patientPackages'),
    ).toHaveLength(0)
  })

  it('flips when sessions exceed total (drift safety: >= sessionsTotal counts as met)', async () => {
    const { maybeCompletePackage } = await importModule()
    seedRecords([
      { id: 'rec-1', sessionsTotal: 1, sessionsExecuted: 2 },
    ])

    const flipped = await maybeCompletePackage('tenant-A', 'pkg-1')

    expect(flipped).toBe(true)
    expect(
      txState.updateCalls.filter((u) => u.table === 'patientPackages'),
    ).toHaveLength(1)
  })
})

// Seed the lock + returning queues so closePackageQuery's chained
// SELECT ... FOR UPDATE and UPDATE ... RETURNING both resolve to a row.
// Pass `status` to drive the active/cancelled/etc branch; pass `null` to
// simulate a missing row (not-found).
function seedClose(
  packageId: string,
  status: 'active' | 'cancelled' | 'completed' | 'expired' | null,
): void {
  if (status === null) {
    txState.patientPackageLockRows.push(null)
    return
  }
  txState.patientPackageLockRows.push({ id: packageId, status })
  // Only successful (active) closes ever reach the UPDATE; pre-seed the
  // returning row so the persisted-row read succeeds.
  if (status === 'active') {
    txState.patientPackageReturningRows.push({
      id: packageId,
      closedAt: new Date('2026-05-28T12:00:00Z'),
      closedReason: 'patient_lost_expiry',
    })
  }
}

describe('closePackage — close metadata + audit', () => {
  it('flips status to completed with closedReason="patient_lost_expiry" and NULL closeNote', async () => {
    const { closePackage } = await importModule()
    seedClose('pkg-1', 'active')

    await closePackage({
      tenantId: 'tenant-A',
      userId: 'user-1',
      packageId: 'pkg-1',
      closedReason: 'patient_lost_expiry',
      closeNote: 'ignored when reason != other',
    })

    const pkgUpdates = txState.updateCalls.filter(
      (u) => u.table === 'patientPackages',
    )
    expect(pkgUpdates).toHaveLength(1)
    expect(pkgUpdates[0].values).toMatchObject({
      status: 'completed',
      closedReason: 'patient_lost_expiry',
      closeNote: null,
    })
    // closedAt should be a Date instance, set inside the call.
    expect(pkgUpdates[0].values.closedAt).toBeInstanceOf(Date)
    // Audit log was emitted with the close-reason change.
    expect(txState.auditCalls).toHaveLength(1)
    expect(txState.auditCalls[0]).toMatchObject({
      tenantId: 'tenant-A',
      userId: 'user-1',
      action: 'update',
      entityType: 'patient_package',
      entityId: 'pkg-1',
      changes: { closedReason: { old: null, new: 'patient_lost_expiry' } },
    })
  })

  it('persists closeNote when closedReason="other"', async () => {
    const { closePackage } = await importModule()
    seedClose('pkg-2', 'active')
    const note = 'Patient transferred to a different clinic.'

    await closePackage({
      tenantId: 'tenant-A',
      userId: 'user-1',
      packageId: 'pkg-2',
      closedReason: 'other',
      closeNote: note,
    })

    const pkgUpdates = txState.updateCalls.filter(
      (u) => u.table === 'patientPackages',
    )
    expect(pkgUpdates).toHaveLength(1)
    expect(pkgUpdates[0].values).toMatchObject({
      status: 'completed',
      closedReason: 'other',
      closeNote: note,
    })
    expect(pkgUpdates[0].values.closedAt).toBeInstanceOf(Date)
    expect(txState.auditCalls).toHaveLength(1)
    expect(txState.auditCalls[0]).toMatchObject({
      changes: { closedReason: { old: null, new: 'other' } },
    })
  })

  it('throws BusinessError("not_found") when the package does not exist', async () => {
    const { closePackage } = await importModule()
    // Lock returns no row → not-found path.
    seedClose('pkg-missing', null)

    let caught: unknown
    try {
      await closePackage({
        tenantId: 'tenant-A',
        userId: 'user-1',
        packageId: 'pkg-missing',
        closedReason: 'patient_lost_expiry',
        closeNote: null,
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeDefined()
    expect((caught as Error).name).toBe('BusinessError')
    expect((caught as { code: string }).code).toBe('not_found')
    // No UPDATE on patientPackages — we bailed before the write.
    expect(
      txState.updateCalls.filter((u) => u.table === 'patientPackages'),
    ).toHaveLength(0)
    // Audit log must NOT fire when the close failed.
    expect(txState.auditCalls).toHaveLength(0)
  })

  it('throws BusinessError("package_not_active") on a cancelled package', async () => {
    const { closePackage } = await importModule()
    // Lock returns a row whose status is terminal → reject before write.
    seedClose('pkg-cancelled', 'cancelled')

    let caught: unknown
    try {
      await closePackage({
        tenantId: 'tenant-A',
        userId: 'user-1',
        packageId: 'pkg-cancelled',
        closedReason: 'patient_lost_expiry',
        closeNote: null,
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeDefined()
    expect((caught as Error).name).toBe('BusinessError')
    expect((caught as { code: string }).code).toBe('package_not_active')
    // No status mutation: a terminal package cannot be re-stamped.
    expect(
      txState.updateCalls.filter((u) => u.table === 'patientPackages'),
    ).toHaveLength(0)
    // Audit log pollution would mask refund disputes — must stay empty.
    expect(txState.auditCalls).toHaveLength(0)
  })

  it('returns the persisted row when the close succeeds on an active package', async () => {
    const { closePackage } = await importModule()
    seedClose('pkg-1', 'active')

    const result = await closePackage({
      tenantId: 'tenant-A',
      userId: 'user-1',
      packageId: 'pkg-1',
      closedReason: 'patient_lost_expiry',
      closeNote: null,
    })

    // Persisted-row shape from the UPDATE ... RETURNING projection.
    expect(result).toMatchObject({
      id: 'pkg-1',
      closedReason: 'patient_lost_expiry',
    })
    expect(result.closedAt).toBeInstanceOf(Date)
    // Audit log fires exactly once on success.
    expect(txState.auditCalls).toHaveLength(1)
  })
})

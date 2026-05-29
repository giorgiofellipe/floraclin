import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Test scope ──────────────────────────────────────────────────────
//
// `executeSession` orchestrates: lock record → lock package → count
// sessions → createSession → side-data writes → status flips → maybe
// complete package → audit log. We mock the DB, the query modules, and
// `maybeCompletePackage` so we can drive each business-gate branch and
// inspect the resulting status decisions without standing up Postgres.
//
// vi.mock factories are hoisted to the top of the file, so all shared
// state lives inside `vi.hoisted()` — declared once, re-bound per test
// via `resetTx` in `beforeEach`.

const { txState, TABLE_TOKENS } = vi.hoisted(() => {
  interface RecordRow {
    id: string
    tenantId: string
    status: string
    sessionsTotal: number
    patientPackageId: string | null
    deletedAt: Date | null
  }
  interface PackageRow {
    status: string
    closedAt: Date | null
  }
  interface UpdateCall {
    table: 'procedureRecords' | 'unknown'
    values: Record<string, unknown>
  }
  interface InsertedSession {
    tenantId: string
    procedureRecordId: string
    sessionOrdinal: number
    performedAt: Date
    executedBy: string
    technique: string | null
    clinicalResponse: string | null
    adverseEffects: string | null
    notes: string | null
    followUpDate: string | null
    nextSessionObjectives: string | null
  }

  interface TxState {
    recordLockResult: RecordRow[]
    packageLockResult: PackageRow[]
    sessionsCount: number
    maxSessionsOrdinalCount: number
    insertedSessions: InsertedSession[]
    updates: UpdateCall[]
    insertedSessionId: string
    productAppCalls: Array<{
      tenantId: string
      procedureRecordId: string
      procedureSessionId: string
      items: unknown
    }>
    diagramCalls: Array<{
      tenantId: string
      procedureRecordId: string
      procedureSessionId: string
      viewType: string
      points: unknown
    }>
    photoCalls: Array<{
      tenantId: string
      procedureRecordId: string
      procedureSessionId: string
      photoAssetIds: string[]
    }>
    auditCalls: Array<{ params: Record<string, unknown> }>
    maybeCompletePackageResult: boolean
    maybeCompletePackageCalls: Array<{ tenantId: string; packageId: string }>
  }

  const txState: TxState = {
    recordLockResult: [],
    packageLockResult: [],
    sessionsCount: 0,
    maxSessionsOrdinalCount: 0,
    insertedSessions: [],
    updates: [],
    insertedSessionId: 'sess-1',
    productAppCalls: [],
    diagramCalls: [],
    photoCalls: [],
    auditCalls: [],
    maybeCompletePackageResult: false,
    maybeCompletePackageCalls: [],
  }

  const TABLE_TOKENS = {
    procedureRecords: { __table: 'procedureRecords' },
    patientPackages: { __table: 'patientPackages' },
    procedureSessions: { __table: 'procedureSessions' },
  } as const

  return { txState, TABLE_TOKENS }
})

function resetTx() {
  txState.recordLockResult = []
  txState.packageLockResult = []
  txState.sessionsCount = 0
  txState.maxSessionsOrdinalCount = 0
  txState.insertedSessions = []
  txState.updates = []
  txState.insertedSessionId = 'sess-1'
  txState.productAppCalls = []
  txState.diagramCalls = []
  txState.photoCalls = []
  txState.auditCalls = []
  txState.maybeCompletePackageResult = false
  txState.maybeCompletePackageCalls = []
}

vi.mock('@/db/client', () => {
  function tagTable(token: unknown): string {
    const tag = (token as { __table?: string } | null)?.__table
    return tag ?? 'unknown'
  }

  function makeTx() {
    return {
      select: (proj?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const tag = tagTable(table)
          // procedureSessions select is the COUNT/MAX path: createSession
          // does MAX+1, countSessionsForRecord does COUNT(*). Both end in
          // `.where(...)` returning a plain Promise of `[{nextOrdinal}]` or
          // `[{n}]`. We discriminate by inspecting the projection keys.
          if (tag === 'procedureSessions') {
            return {
              where: () => {
                const keys = Object.keys(proj ?? {})
                if (keys.includes('nextOrdinal')) {
                  return Promise.resolve([
                    { nextOrdinal: txState.sessionsCount + 1 },
                  ])
                }
                // countSessionsForRecord projects `{ n }`.
                return Promise.resolve([{ n: txState.sessionsCount }])
              },
            }
          }

          // procedureRecords / patientPackages: locked SELECT for the
          // business gates. Both end in `.for('update').limit(1)`.
          return {
            where: () => ({
              for: (_mode: string) => ({
                limit: (_n: number) => {
                  if (tag === 'procedureRecords') {
                    return Promise.resolve(txState.recordLockResult)
                  }
                  if (tag === 'patientPackages') {
                    return Promise.resolve(txState.packageLockResult)
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
              const row = {
                id: txState.insertedSessionId,
                tenantId: vals.tenantId as string,
                procedureRecordId: vals.procedureRecordId as string,
                sessionOrdinal: vals.sessionOrdinal as number,
                performedAt: vals.performedAt as Date,
                executedBy: vals.executedBy as string,
                technique: (vals.technique ?? null) as string | null,
                clinicalResponse: (vals.clinicalResponse ?? null) as string | null,
                adverseEffects: (vals.adverseEffects ?? null) as string | null,
                notes: (vals.notes ?? null) as string | null,
                followUpDate: (vals.followUpDate ?? null) as string | null,
                nextSessionObjectives: (vals.nextSessionObjectives ?? null) as
                  | string
                  | null,
              }
              txState.insertedSessions.push(row as never)
              // After insert, bump the in-memory count so a follow-up
              // MAX+1 / COUNT(*) call in the same tx (e.g. createSession
              // chained on another call) sees the new row.
              txState.sessionsCount += 1
              return Promise.resolve([row])
            }
            return Promise.resolve([])
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => {
            const tag = tagTable(table) as 'procedureRecords' | 'unknown'
            txState.updates.push({
              table: tag === 'procedureRecords' ? 'procedureRecords' : 'unknown',
              values: vals,
            })
            return Promise.resolve(undefined)
          },
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

vi.mock('@/lib/tenant', () => ({
  withTransaction: async (
    fn: (tx: Record<string, unknown>) => Promise<unknown>,
  ) => {
    const { db } = await import('@/db/client')
    // Re-use the same transaction harness as `db.transaction`. Cast away
    // the type — the mock's tx and the real `typeof db` are intentionally
    // structurally different (the mock is a tiny subset).
    return (
      db as unknown as {
        transaction: (
          fn: (tx: Record<string, unknown>) => Promise<unknown>,
        ) => Promise<unknown>
      }
    ).transaction(fn)
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

// drizzle operators are opaque to our stub — pass them straight through.
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

// Stub the side-effect modules so we can assert they were called with the
// session id `executeSession` just minted, without re-implementing each.
vi.mock('@/db/queries/product-applications', () => ({
  saveProductApplicationsForSession: vi.fn(
    async (
      tenantId: string,
      procedureRecordId: string,
      procedureSessionId: string,
      items: unknown,
    ) => {
      txState.productAppCalls.push({
        tenantId,
        procedureRecordId,
        procedureSessionId,
        items,
      })
      return []
    },
  ),
}))

vi.mock('@/db/queries/face-diagrams', () => ({
  saveFaceDiagramForSession: vi.fn(
    async (
      tenantId: string,
      procedureRecordId: string,
      procedureSessionId: string,
      viewType: string,
      points: unknown,
    ) => {
      txState.diagramCalls.push({
        tenantId,
        procedureRecordId,
        procedureSessionId,
        viewType,
        points,
      })
      return 'diag-1'
    },
  ),
}))

vi.mock('@/db/queries/photos', () => ({
  assignPhotosToSession: vi.fn(
    async (
      tenantId: string,
      procedureRecordId: string,
      procedureSessionId: string,
      photoAssetIds: string[],
    ) => {
      txState.photoCalls.push({
        tenantId,
        procedureRecordId,
        procedureSessionId,
        photoAssetIds,
      })
      return []
    },
  ),
}))

vi.mock('@/lib/packages', () => ({
  maybeCompletePackage: vi.fn(async (tenantId: string, packageId: string) => {
    txState.maybeCompletePackageCalls.push({ tenantId, packageId })
    return txState.maybeCompletePackageResult
  }),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async (params: Record<string, unknown>) => {
    txState.auditCalls.push({ params })
  }),
}))

// Re-imported AFTER mocks are in place. Top-level imports above the mocks
// would be substituted at hoist time, so we go through a function.
const importModule = async () => await import('../session-execute')

const TENANT = '00000000-0000-0000-0000-000000000001'
const RECORD = '00000000-0000-0000-0000-000000000aaa'
const USER = '00000000-0000-0000-0000-000000000bbb'
const PACKAGE = '00000000-0000-0000-0000-000000000ccc'

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: TENANT,
    procedureRecordId: RECORD,
    executedBy: USER,
    performedAt: new Date('2026-05-28T12:00:00Z'),
    ...overrides,
  }
}

describe('executeSession — status transitions', () => {
  beforeEach(() => {
    resetTx()
  })

  it('flips approved → in_progress after first session of a multi-session line', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 4,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    txState.sessionsCount = 0

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.recordStatus).toBe('in_progress')
    expect(txState.updates).toHaveLength(1)
    expect(txState.updates[0].table).toBe('procedureRecords')
    expect(txState.updates[0].values).toMatchObject({
      status: 'in_progress',
    })
    expect(txState.insertedSessions).toHaveLength(1)
    expect(txState.insertedSessions[0].sessionOrdinal).toBe(1)
  })

  it('flips approved → completed (direct) for a single-session line', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 1,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    txState.sessionsCount = 0

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.recordStatus).toBe('completed')
    expect(txState.updates[0].values).toMatchObject({ status: 'completed' })
  })

  it('flips in_progress → completed after the last session', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'in_progress',
        sessionsTotal: 4,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    // Three sessions already done — this one fills the line.
    txState.sessionsCount = 3

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.recordStatus).toBe('completed')
    expect(txState.updates[0].values).toMatchObject({ status: 'completed' })
    expect(txState.insertedSessions[0].sessionOrdinal).toBe(4)
  })

  it('does NOT touch procedure_records when a middle session lands and status stays in_progress', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'in_progress',
        sessionsTotal: 4,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    txState.sessionsCount = 1 // second session lands — still in_progress

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.recordStatus).toBe('in_progress')
    // No status update fired because nextStatus === record.status.
    expect(txState.updates).toHaveLength(0)
  })
})

describe('executeSession — package completion', () => {
  beforeEach(() => {
    resetTx()
  })

  it('flips patient_package to completed when every line is completed', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'in_progress',
        sessionsTotal: 2,
        patientPackageId: PACKAGE,
        deletedAt: null,
      },
    ]
    txState.packageLockResult = [{ status: 'active', closedAt: null }]
    txState.sessionsCount = 1
    txState.maybeCompletePackageResult = true

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.recordStatus).toBe('completed')
    expect(result.packageCompleted).toBe(true)
    expect(txState.maybeCompletePackageCalls).toEqual([
      { tenantId: TENANT, packageId: PACKAGE },
    ])
  })

  it('does not call maybeCompletePackage when no package is linked', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 1,
        patientPackageId: null,
        deletedAt: null,
      },
    ]

    const { executeSession } = await importModule()
    const result = await executeSession(baseInput())

    expect(result.packageCompleted).toBe(false)
    expect(txState.maybeCompletePackageCalls).toEqual([])
  })
})

describe('executeSession — business gates', () => {
  beforeEach(() => {
    resetTx()
  })

  it('refuses to insert a session when the record is missing (not_found)', async () => {
    txState.recordLockResult = []

    const { executeSession } = await importModule()
    await expect(executeSession(baseInput())).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'not_found',
    })
    expect(txState.insertedSessions).toHaveLength(0)
  })

  it('refuses to insert when the record is soft-deleted (not_found)', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 1,
        patientPackageId: null,
        deletedAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]

    const { executeSession } = await importModule()
    await expect(executeSession(baseInput())).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it.each(['completed', 'cancelled'] as const)(
    'refuses to insert when record is already terminal (%s)',
    async (status) => {
      txState.recordLockResult = [
        {
          id: RECORD,
          tenantId: TENANT,
          status,
          sessionsTotal: 1,
          patientPackageId: null,
          deletedAt: null,
        },
      ]

      const { executeSession } = await importModule()
      await expect(executeSession(baseInput())).rejects.toMatchObject({
        code: 'record_already_terminal',
      })
      expect(txState.insertedSessions).toHaveLength(0)
    },
  )

  it('refuses to insert a session when the package is closed (package_terminal)', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 2,
        patientPackageId: PACKAGE,
        deletedAt: null,
      },
    ]
    txState.packageLockResult = [
      { status: 'active', closedAt: new Date('2026-05-01T00:00:00Z') },
    ]

    const { executeSession } = await importModule()
    await expect(executeSession(baseInput())).rejects.toMatchObject({
      code: 'package_terminal',
    })
    expect(txState.insertedSessions).toHaveLength(0)
  })

  it.each(['cancelled', 'completed'] as const)(
    'refuses to insert when package status is %s (package_terminal)',
    async (status) => {
      txState.recordLockResult = [
        {
          id: RECORD,
          tenantId: TENANT,
          status: 'approved',
          sessionsTotal: 2,
          patientPackageId: PACKAGE,
          deletedAt: null,
        },
      ]
      txState.packageLockResult = [{ status, closedAt: null }]

      const { executeSession } = await importModule()
      await expect(executeSession(baseInput())).rejects.toMatchObject({
        code: 'package_terminal',
      })
    },
  )

  it('refuses when the linked package no longer exists (package_missing)', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 2,
        patientPackageId: PACKAGE,
        deletedAt: null,
      },
    ]
    txState.packageLockResult = []

    const { executeSession } = await importModule()
    await expect(executeSession(baseInput())).rejects.toMatchObject({
      code: 'package_missing',
    })
  })

  it('refuses to insert when the record is already saturated (all_sessions_executed)', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'in_progress',
        sessionsTotal: 2,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    txState.sessionsCount = 2 // already at total

    const { executeSession } = await importModule()
    await expect(executeSession(baseInput())).rejects.toMatchObject({
      code: 'all_sessions_executed',
    })
    expect(txState.insertedSessions).toHaveLength(0)
  })
})

describe('executeSession — side data + audit', () => {
  beforeEach(() => {
    resetTx()
  })

  it('persists product applications, diagrams, and photo reassignments with the new session id', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 4,
        patientPackageId: null,
        deletedAt: null,
      },
    ]
    txState.sessionsCount = 0
    txState.insertedSessionId = 'sess-new'

    const { executeSession } = await importModule()
    await executeSession(
      baseInput({
        productApplications: [
          {
            productName: 'Botox 100U',
            totalQuantity: 50,
            quantityUnit: 'U',
          },
        ],
        diagrams: [
          {
            viewType: 'front',
            points: [
              {
                x: 50,
                y: 50,
                productName: 'Botox',
                quantity: 2,
                quantityUnit: 'U',
              },
            ],
          },
        ],
        photoAssetIds: ['photo-1', 'photo-2'],
      }),
    )

    expect(txState.productAppCalls).toHaveLength(1)
    expect(txState.productAppCalls[0].procedureSessionId).toBe('sess-new')
    expect(txState.diagramCalls).toHaveLength(1)
    expect(txState.diagramCalls[0].procedureSessionId).toBe('sess-new')
    expect(txState.photoCalls).toHaveLength(1)
    expect(txState.photoCalls[0]).toMatchObject({
      tenantId: TENANT,
      procedureRecordId: RECORD,
      procedureSessionId: 'sess-new',
      photoAssetIds: ['photo-1', 'photo-2'],
    })
  })

  it('skips side-data calls when no inputs are provided', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 4,
        patientPackageId: null,
        deletedAt: null,
      },
    ]

    const { executeSession } = await importModule()
    await executeSession(baseInput())

    expect(txState.productAppCalls).toHaveLength(0)
    expect(txState.diagramCalls).toHaveLength(0)
    expect(txState.photoCalls).toHaveLength(0)
  })

  it('emits an audit log with the new session ordinal', async () => {
    txState.recordLockResult = [
      {
        id: RECORD,
        tenantId: TENANT,
        status: 'approved',
        sessionsTotal: 2,
        patientPackageId: null,
        deletedAt: null,
      },
    ]

    const { executeSession } = await importModule()
    await executeSession(baseInput())

    expect(txState.auditCalls).toHaveLength(1)
    expect(txState.auditCalls[0].params).toMatchObject({
      tenantId: TENANT,
      userId: USER,
      action: 'create',
      entityType: 'procedure_session',
      changes: { sessionOrdinal: { old: null, new: 1 } },
    })
  })
})

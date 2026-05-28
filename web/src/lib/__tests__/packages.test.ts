import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Pure-function tests ─────────────────────────────────────────────
//
// These exercise the date math + completion predicate without touching
// the DB. The race-safety + tenant-scope tests live below and use a
// hand-rolled transaction harness so we can assert the SQL execution
// order without standing up a real Postgres.
//
// What the harness lets us prove:
//   1. startPackageSession locks the parent `patient_packages` row
//      BEFORE the `patient_package_lines` row (consistent order with
//      cancelPackage, prevents ABBA deadlocks).
//   2. Both raw-SQL lock fragments include `AND tenant_id = ...` so a
//      cross-tenant id can never acquire a lock.
//   3. sellPackage refuses any procedureTypeId that doesn't belong to
//      the caller's tenant, and derives `procedureTypeName` from the
//      verified server-side lookup (ignores the client-supplied name).
//   4. createPackageTemplate / updatePackageTemplate would catch a
//      cross-tenant procedureTypeId — covered indirectly via the same
//      helper plus a small standalone case in db/queries/packages tests.

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

const { txState, TABLE_TOKENS, lookups } = vi.hoisted(() => {
  interface ExecuteCall {
    fragment: string
    params: unknown[]
  }
  interface TxState {
    executeResponses: Array<{ rows: Array<Record<string, unknown>> }>
    executeCalls: ExecuteCall[]
    countRows: Array<{ count: number }>
    selectRows: Array<Record<string, unknown>>
    insertedProcedures: Array<Record<string, unknown>>
    insertedPackages: Array<Record<string, unknown>>
    insertedLines: Array<Record<string, unknown>>
  }
  const txState: TxState = {
    executeResponses: [],
    executeCalls: [],
    countRows: [{ count: 0 }],
    selectRows: [],
    insertedProcedures: [],
    insertedPackages: [],
    insertedLines: [],
  }
  const TABLE_TOKENS = {
    patientPackages: { __table: 'patientPackages' },
    patientPackageLines: { __table: 'patientPackageLines' },
    procedureRecords: { __table: 'procedureRecords' },
    procedureTypes: { __table: 'procedureTypes' },
    packageTemplates: { __table: 'packageTemplates' },
  } as const
  const lookups = {
    procedureTypes: [] as Array<{ id: string; name: string }>,
    packageTemplates: [] as Array<{ id: string }>,
  }
  // Stash on globalThis so mock factories (which run at hoist time) can
  // reach the same shared state without recreating it per factory.
  ;(globalThis as Record<string, unknown>).__pkg_test_tokens = TABLE_TOKENS
  ;(globalThis as Record<string, unknown>).__pkg_test_txState = txState
  ;(globalThis as Record<string, unknown>).__pkg_test_lookups = lookups
  return { txState, TABLE_TOKENS, lookups }
})

function resetTx() {
  txState.executeResponses = []
  txState.executeCalls = []
  txState.countRows = [{ count: 0 }]
  txState.selectRows = []
  txState.insertedProcedures = []
  txState.insertedPackages = []
  txState.insertedLines = []
  lookups.procedureTypes = []
  lookups.packageTemplates = []
}

// `makeTx` lives in vi.hoisted so the mock factories below can reach it.
const { makeTx } = vi.hoisted(() => {
  // Re-declare token tokens in the same closure so makeTx can identity-match.
  // We use the same shape as TABLE_TOKENS above; identity is preserved
  // because both are constructed inside the same hoisted block at startup.
  // (See later: we read the same lookups/txState objects through closure.)
  return {
    makeTx: () => {
      // Late-bind references to the outer hoisted block via globalThis so
      // mock factories (also hoisted) share the same harness instance.
      type SharedTxState = {
        executeResponses: Array<{ rows: Array<Record<string, unknown>> }>
        executeCalls: Array<{ fragment: string; params: unknown[] }>
        countRows: Array<{ count: number }>
        selectRows: Array<Record<string, unknown>>
        insertedProcedures: Array<Record<string, unknown>>
        insertedPackages: Array<Record<string, unknown>>
        insertedLines: Array<Record<string, unknown>>
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
        select: (_proj?: unknown) => ({
          from: (table: unknown) => ({
            where: () => {
              // Return an actual Promise that also exposes .limit(), so callers
              // that await it directly (the consumed-slot count) and callers
              // that chain .limit() both work.
              const data =
                tagOf(table) === 'procedureRecords' ? ST.countRows : ST.selectRows
              const p: Promise<unknown[]> & {
                limit?: (n: number) => Promise<unknown[]>
              } = Promise.resolve(data)
              p.limit = () => Promise.resolve(data)
              return p
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            const tag = tagOf(table)
            if (tag === 'procedureRecords') {
              return {
                returning: () => {
                  ST.insertedProcedures.push(vals)
                  return Promise.resolve([{ id: 'proc-1' }])
                },
              }
            }
            if (tag === 'patientPackages') {
              return {
                returning: () => {
                  ST.insertedPackages.push(vals)
                  return Promise.resolve([{ id: 'pkg-1', patientId: vals.patientId }])
                },
              }
            }
            if (tag === 'patientPackageLines') {
              ST.insertedLines.push(vals)
              return Promise.resolve(undefined)
            }
            return { returning: () => Promise.resolve([]) }
          },
        }),
      }
    },
  }
})

vi.mock('@/db/client', () => ({
  db: {
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return fn(makeTx())
    },
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          const g = globalThis as Record<string, unknown>
          const LK = g.__pkg_test_lookups as {
            procedureTypes: Array<{ id: string; name: string }>
            packageTemplates: Array<{ id: string }>
          }
          // Identity-compare via __table tag: the schema mock spreads the
          // token into a new object, so `table === TT.procedureTypes` would
          // be false. The __table tag survives the spread.
          const tag = (table as { __table?: string }).__table
          if (tag === 'procedureTypes') {
            return Promise.resolve(LK.procedureTypes)
          }
          if (tag === 'packageTemplates') {
            return {
              limit: () => Promise.resolve(LK.packageTemplates),
            }
          }
          return Promise.resolve([])
        },
      }),
    }),
  },
}))

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
    patientPackageLines: { __table: string }
    procedureRecords: { __table: string }
    procedureTypes: { __table: string }
    packageTemplates: { __table: string }
  }
  return {
    patientPackages: {
      ...TT.patientPackages,
      id: 'id',
      tenantId: 'tenant_id',
      status: 'status',
      expiresAt: 'expires_at',
      patientId: 'patient_id',
    },
    patientPackageLines: {
      ...TT.patientPackageLines,
      id: 'id',
      patientPackageId: 'patient_package_id',
    },
    procedureRecords: {
      ...TT.procedureRecords,
      id: 'id',
      tenantId: 'tenant_id',
      status: 'status',
      patientPackageLineId: 'patient_package_line_id',
      patientPackageId: 'patient_package_id',
      deletedAt: 'deleted_at',
    },
    procedureTypes: {
      ...TT.procedureTypes,
      id: 'id',
      tenantId: 'tenant_id',
      name: 'name',
      deletedAt: 'deleted_at',
    },
    packageTemplates: {
      ...TT.packageTemplates,
      id: 'id',
      tenantId: 'tenant_id',
      deletedAt: 'deleted_at',
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

// Re-import after mocks are in place. Top-level imports above (used by the
// pure-function tests) are not affected — they reference the already-loaded
// helpers, not the live mocked side.
const importModule = async () => await import('../packages')

beforeEach(() => {
  resetTx()
})

describe('startPackageSession — lock order + tenant scope', () => {
  it('locks the package row BEFORE the line row', async () => {
    const { startPackageSession } = await importModule()

    // Queue: first execute call returns the package row, second returns the line row.
    txState.executeResponses.push({
      rows: [
        {
          id: 'pkg-1',
          tenant_id: 'tenant-A',
          patient_id: 'pat-1',
          status: 'active',
          expires_at: null,
        },
      ],
    })
    txState.executeResponses.push({
      rows: [
        {
          id: 'line-1',
          patient_package_id: 'pkg-1',
          procedure_type_id: 'pt-1',
          procedure_type_name: 'Botox',
          sessions_total: 4,
        },
      ],
    })
    txState.countRows = [{ count: 0 }]

    await startPackageSession({
      tenantId: 'tenant-A',
      practitionerId: 'user-1',
      patientPackageId: 'pkg-1',
      patientPackageLineId: 'line-1',
    })

    expect(txState.executeCalls).toHaveLength(2)
    // First call must touch patient_packages, second must touch patient_package_lines.
    expect(txState.executeCalls[0].fragment).toContain('patient_packages')
    expect(txState.executeCalls[0].fragment).not.toContain('patient_package_lines')
    expect(txState.executeCalls[1].fragment).toContain('patient_package_lines')
    // Both must declare FOR UPDATE.
    expect(txState.executeCalls[0].fragment).toContain('FOR UPDATE')
    expect(txState.executeCalls[1].fragment).toContain('FOR UPDATE')
  })

  it('scopes the package lock by tenant_id', async () => {
    const { startPackageSession } = await importModule()

    txState.executeResponses.push({ rows: [] }) // package lock — empty
    await expect(
      startPackageSession({
        tenantId: 'tenant-A',
        practitionerId: 'user-1',
        patientPackageId: 'pkg-1',
        patientPackageLineId: 'line-1',
      }),
    ).rejects.toThrow('Pacote não encontrado')

    // The package lock fragment must mention tenant_id (the AND tenant_id clause).
    expect(txState.executeCalls[0].fragment).toContain('tenant_id')
    // We never proceeded to the line lock since the package lookup returned nothing.
    expect(txState.executeCalls).toHaveLength(1)
  })

  it('scopes the line lock by tenant_id', async () => {
    const { startPackageSession } = await importModule()

    txState.executeResponses.push({
      rows: [
        {
          id: 'pkg-1',
          tenant_id: 'tenant-A',
          patient_id: 'pat-1',
          status: 'active',
          expires_at: null,
        },
      ],
    })
    txState.executeResponses.push({ rows: [] }) // line lock — empty (cross-tenant)

    await expect(
      startPackageSession({
        tenantId: 'tenant-A',
        practitionerId: 'user-1',
        patientPackageId: 'pkg-1',
        patientPackageLineId: 'line-1',
      }),
    ).rejects.toThrow('Linha do pacote não encontrada')

    expect(txState.executeCalls[1].fragment).toContain('tenant_id')
  })

  it('rejects when an expired package has no override', async () => {
    const { startPackageSession } = await importModule()
    txState.executeResponses.push({
      rows: [
        {
          id: 'pkg-1',
          tenant_id: 'tenant-A',
          patient_id: 'pat-1',
          status: 'expired',
          expires_at: '2020-01-01',
        },
      ],
    })

    await expect(
      startPackageSession({
        tenantId: 'tenant-A',
        practitionerId: 'user-1',
        patientPackageId: 'pkg-1',
        patientPackageLineId: 'line-1',
      }),
    ).rejects.toThrow('Pacote expirado')
  })
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

describe('sellPackage — cross-tenant FK validation + server-derived names', () => {
  it('rejects when a procedureTypeId does not belong to the tenant', async () => {
    const { sellPackage } = await importModule()
    // Lookup returns 1 row but we asked about 2 — set membership mismatch.
    lookups.procedureTypes = [{ id: 'pt-1', name: 'Botox' }]

    await expect(
      sellPackage({
        tenantId: 'tenant-A',
        soldBy: 'user-1',
        input: {
          patientId: 'pat-1',
          templateId: null,
          name: 'Pacote Test',
          totalAmount: 100,
          validityMonths: null,
          installmentCount: 1,
          paymentMethod: 'pix',
          lines: [
            {
              procedureTypeId: 'pt-1',
              procedureTypeName: 'Botox',
              sessionsTotal: 2,
            },
            {
              procedureTypeId: 'pt-2-other-tenant',
              procedureTypeName: 'Forged',
              sessionsTotal: 2,
            },
          ],
        },
      }),
    ).rejects.toThrow(/outro estabelecimento|inválido/)

    // No package row was ever inserted.
    expect(txState.insertedPackages).toHaveLength(0)
  })

  it('rejects when templateId belongs to a different tenant', async () => {
    const { sellPackage } = await importModule()
    lookups.procedureTypes = [{ id: 'pt-1', name: 'Botox' }]
    lookups.packageTemplates = [] // template lookup miss

    await expect(
      sellPackage({
        tenantId: 'tenant-A',
        soldBy: 'user-1',
        input: {
          patientId: 'pat-1',
          templateId: 'tpl-from-other-tenant',
          name: 'Pacote Test',
          totalAmount: 100,
          validityMonths: null,
          installmentCount: 1,
          paymentMethod: 'pix',
          lines: [
            {
              procedureTypeId: 'pt-1',
              procedureTypeName: 'Botox',
              sessionsTotal: 2,
            },
          ],
        },
      }),
    ).rejects.toThrow(/Modelo.*outro estabelecimento|inválido/)

    expect(txState.insertedPackages).toHaveLength(0)
  })

  it('derives procedureTypeName from the verified server-side lookup, ignoring client input', async () => {
    const { sellPackage } = await importModule()
    lookups.procedureTypes = [{ id: 'pt-1', name: 'Toxina Botulínica (canônico)' }]
    lookups.packageTemplates = []

    await sellPackage({
      tenantId: 'tenant-A',
      soldBy: 'user-1',
      input: {
        patientId: 'pat-1',
        templateId: null,
        name: 'Pacote Test',
        totalAmount: 100,
        validityMonths: null,
        installmentCount: 1,
        paymentMethod: 'pix',
        lines: [
          {
            procedureTypeId: 'pt-1',
            // Client-supplied name — should be ignored in favor of the
            // server-verified canonical name.
            procedureTypeName: '<script>alert(1)</script>',
            sessionsTotal: 2,
          },
        ],
      },
    })

    expect(txState.insertedLines).toHaveLength(1)
    expect(txState.insertedLines[0].procedureTypeName).toBe(
      'Toxina Botulínica (canônico)',
    )
    expect(txState.insertedLines[0].procedureTypeName).not.toBe(
      '<script>alert(1)</script>',
    )
  })
})

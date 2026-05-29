/**
 * Tests for `finalizeEncounter` (Task C1).
 *
 * Two layers:
 *
 *   1. Pure-function tests for `__test__.computeExpiresAt` — these prove the
 *      BR-anchored expiry math (Patch P5) without needing a DB. The host TZ
 *      is forced to UTC and the system clock is frozen at a BR-late-night
 *      moment to verify the day doesn't drift forward.
 *
 *   2. Transaction-harness tests for the full service — these prove the
 *      end-to-end flow: locks are acquired with `FOR UPDATE` scoped by
 *      tenant + patient, drafts are UPDATEd in place (Patch P1 — never
 *      INSERTed fresh), `plannedSnapshot` survives finalization, the
 *      financial entry is created via the shared helper, and a package row
 *      is created only when the cart is a bundle.
 *
 * The harness mocks `db.transaction(...)` and the chained methods, capturing
 * the calls so we can assert order + payloads without a real Postgres.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { __test__ } from '../encounter-finalize'

// ─── Pure helper: computeExpiresAt (Patch P5) ────────────────────────

describe('computeExpiresAt — BR-anchored expiry', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'UTC'
  })

  afterEach(() => {
    process.env.TZ = originalTz
    vi.useRealTimers()
  })

  it('returns null when validityMonths is null', () => {
    expect(__test__.computeExpiresAt(null)).toBeNull()
  })

  it('returns null when validityMonths is undefined', () => {
    // @ts-expect-error — guarding the runtime nullish check
    expect(__test__.computeExpiresAt(undefined)).toBeNull()
  })

  it('adds whole months anchored to BR day (Patch P5 — late-night BR safety)', () => {
    // 2026-05-28T02:30:00Z === 2026-05-27 23:30:00 BR.
    // A naive `addMonths(new Date(), 6)` on a UTC container would produce
    // 2026-11-28 (UTC day + 6 months). The BR-anchored helper must return
    // 2026-11-27 because the BR calendar day at that instant is the 27th.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-28T02:30:00Z'))
    expect(__test__.computeExpiresAt(6)).toBe('2026-11-27')
  })

  it('clamps day when target month is shorter (date-fns addMonths semantics)', () => {
    // 2026-01-31 BR + 1 month = 2026-02-28 (Feb has 28 days in 2026).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-31T15:00:00Z')) // 12:00 BR
    expect(__test__.computeExpiresAt(1)).toBe('2026-02-28')
  })

  it('handles 12 months (one year) correctly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T15:00:00Z')) // 12:00 BR
    expect(__test__.computeExpiresAt(12)).toBe('2027-05-27')
  })
})

// ─── Service tests: hand-rolled tx harness ───────────────────────────
//
// We don't have a real Postgres in unit tests. Instead we mock the db
// module, capturing every operation against the transaction so we can
// assert:
//   - The exact ordering of SQL operations (lock → financial entry →
//     package → update drafts → consents → audit).
//   - That UPDATEs against `procedure_records` carry the expected fields
//     and DO NOT touch `plannedSnapshot` (Patch P1).
//   - That the financial entry uses the shared `createFinancialEntry`
//     helper, not a raw insert (Patch P1).
//   - That the package row is only created when the cart is a bundle.
//
// vi.mock factories are hoisted, so anything they touch must come from
// vi.hoisted().

const { txState, createFinancialEntryMock } = vi.hoisted(() => {
  interface ExecuteCall {
    fragment: string
    params: unknown[]
  }
  interface InsertCall {
    table: string
    values: Record<string, unknown>
  }
  interface UpdateCall {
    table: string
    set: Record<string, unknown>
  }
  interface TxState {
    executeResponses: Array<{ rows: Array<Record<string, unknown>> }>
    executeCalls: ExecuteCall[]
    insertCalls: InsertCall[]
    updateCalls: UpdateCall[]
    insertedPackageId: string
  }
  const txState: TxState = {
    executeResponses: [],
    executeCalls: [],
    insertCalls: [],
    updateCalls: [],
    insertedPackageId: 'pkg-id-generated',
  }
  ;(globalThis as Record<string, unknown>).__atfin_state = txState

  const createFinancialEntryMock = vi.fn(
    async (
      _tenantId: string,
      _userId: string,
      _data: Record<string, unknown>,
      _tx?: unknown,
    ): Promise<{ id: string }> => ({ id: 'fe-id-generated' }),
  )
  ;(globalThis as Record<string, unknown>).__atfin_createFinancialEntryMock = createFinancialEntryMock

  return { txState, createFinancialEntryMock }
})

function resetTx() {
  txState.executeResponses = []
  txState.executeCalls = []
  txState.insertCalls = []
  txState.updateCalls = []
  createFinancialEntryMock.mockClear()
  createFinancialEntryMock.mockImplementation(async () => ({ id: 'fe-id-generated' }))
}

// Stub @/db/queries/financial so we can assert against createFinancialEntry.
vi.mock('@/db/queries/financial', () => {
  const g = globalThis as Record<string, unknown>
  return { createFinancialEntry: g.__atfin_createFinancialEntryMock }
})

// Stub the schema imports — they're just used as table tokens in our impl.
vi.mock('@/db/schema', () => ({
  patientPackages: { __table: 'patientPackages' },
  procedureRecords: { __table: 'procedureRecords' },
  consentAcceptances: { __table: 'consentAcceptances' },
  // Other tables that drizzle pulls in transitively
  tenants: { __table: 'tenants' },
  patients: { __table: 'patients' },
  procedureTypes: { __table: 'procedureTypes' },
  appointments: { __table: 'appointments' },
  financialEntries: { __table: 'financialEntries' },
  installments: { __table: 'installments' },
  auditLogs: { __table: 'auditLogs' },
  users: { __table: 'users' },
  consentTemplates: { __table: 'consentTemplates' },
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async () => undefined),
}))

vi.mock('@/db/client', () => {
  const g = globalThis as Record<string, unknown>
  const ST = g.__atfin_state as typeof txState
  const tagOf = (t: unknown): string | undefined =>
    (t as { __table?: string } | null)?.__table

  function makeTx() {
    return {
      execute: (sqlObj: unknown) => {
        const fragment = JSON.stringify(sqlObj)
        ST.executeCalls.push({ fragment, params: [] })
        const response = ST.executeResponses.shift() ?? { rows: [] }
        return Promise.resolve(response)
      },
      insert: (table: unknown) => {
        const tableName = tagOf(table) ?? 'unknown'
        return {
          values: (vals: Record<string, unknown>) => {
            ST.insertCalls.push({ table: tableName, values: vals })
            return {
              returning: () => {
                if (tableName === 'patientPackages') {
                  return Promise.resolve([{ id: ST.insertedPackageId }])
                }
                return Promise.resolve([{}])
              },
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            }
          },
        }
      },
      update: (table: unknown) => {
        const tableName = tagOf(table) ?? 'unknown'
        return {
          set: (vals: Record<string, unknown>) => {
            ST.updateCalls.push({ table: tableName, set: vals })
            return {
              where: () => Promise.resolve(undefined),
            }
          },
        }
      },
    }
  }

  return {
    db: {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
    },
  }
})

// Import AFTER mocks are set up.
const { finalizeEncounter } = await import('../encounter-finalize')

// ─── Fixtures ────────────────────────────────────────────────────────

const tenantId = '00000000-0000-0000-0000-000000000001'
const patientId = '00000000-0000-0000-0000-000000000002'
const practitionerId = '00000000-0000-0000-0000-000000000003'
const userId = practitionerId
const encounterId = '00000000-0000-0000-0000-0000000000a1'

const adhocCart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [
    {
      procedureTypeId: '00000000-0000-0000-0000-000000000bbb',
      procedureTypeName: 'Botox',
      sessions: 1,
      defaultPrice: 800,
      sourceTemplateLineId: null,
    },
  ],
  totalOverride: null,
}

const bundleCart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: 6,
  lines: [
    {
      procedureTypeId: '00000000-0000-0000-0000-000000000aaa',
      procedureTypeName: 'Skinbooster',
      sessions: 4,
      defaultPrice: 400,
      sourceTemplateLineId: null,
    },
  ],
  totalOverride: null,
}

const multiLineCart = {
  templateId: '00000000-0000-0000-0000-0000000000aa',
  templateName: 'Combo Botox + Skin',
  templateDefaultPrice: 2400,
  templateValidityMonths: 6,
  lines: [
    {
      procedureTypeId: '00000000-0000-0000-0000-000000000bbb',
      procedureTypeName: 'Botox',
      sessions: 1,
      defaultPrice: 800,
      sourceTemplateLineId: '00000000-0000-0000-0000-0000000000bb',
    },
    {
      procedureTypeId: '00000000-0000-0000-0000-000000000aaa',
      procedureTypeName: 'Skinbooster',
      sessions: 4,
      defaultPrice: 400,
      sourceTemplateLineId: '00000000-0000-0000-0000-0000000000cc',
    },
  ],
  totalOverride: null,
}

// ─── Service-level behaviour ─────────────────────────────────────────

describe('finalizeEncounter', () => {
  beforeEach(() => {
    resetTx()
  })

  it('rejects when draftRecordIds length does not match cart.lines', async () => {
    await expect(
      finalizeEncounter({
        tenantId,
        userId,
        encounterId,
        patientId,
        practitionerId,
        cart: adhocCart,
        draftRecordIds: [], // mismatch
        financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
        consents: [],
      }),
    ).rejects.toThrow(/draftRecordIds length/)
  })

  it('creates a package row when any line is multi-session', async () => {
    const draftId = '00000000-0000-0000-0000-00000000d001'
    txState.executeResponses.push({
      rows: [{ id: draftId, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: { foo: 1 } }],
    })

    const result = await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: bundleCart,
      draftRecordIds: [draftId],
      financialPlan: { totalAmount: '1600.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    expect(result.patientPackageId).not.toBeNull()
    expect(result.procedureRecordIds).toEqual([draftId])
    expect(result.financialEntryId).toBe('fe-id-generated')
    // The returned encounterId is exactly what the caller supplied — the
    // wizard's URL UUID survives through to persistence (FIX A).
    expect(result.encounterId).toBe(encounterId)

    // A patient_packages insert happened.
    const pkgInsert = txState.insertCalls.find((c) => c.table === 'patientPackages')
    expect(pkgInsert).toBeDefined()
    expect(pkgInsert!.values.name).toBe('Pacote Skinbooster — 4 sessões')
    expect(pkgInsert!.values.status).toBe('active')
    expect(pkgInsert!.values.financialEntryId).toBe('fe-id-generated')
  })

  it('skips package row for a single ad-hoc session', async () => {
    const draftId = '00000000-0000-0000-0000-00000000d002'
    txState.executeResponses.push({
      rows: [{ id: draftId, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null }],
    })

    const result = await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftId],
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    expect(result.patientPackageId).toBeNull()
    expect(result.procedureRecordIds).toEqual([draftId])
    const pkgInsert = txState.insertCalls.find((c) => c.table === 'patientPackages')
    expect(pkgInsert).toBeUndefined()
  })

  it('locks drafts with FOR UPDATE scoped by tenant + patient (Patch P1)', async () => {
    const draftId = '00000000-0000-0000-0000-00000000d003'
    txState.executeResponses.push({
      rows: [{ id: draftId, tenant_id: tenantId, patient_id: patientId, status: 'planned', planned_snapshot: null }],
    })

    await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftId],
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    // First execute call is the lock. It must contain FOR UPDATE and be
    // scoped by tenant + patient.
    const firstExec = txState.executeCalls[0]
    expect(firstExec).toBeDefined()
    expect(firstExec.fragment).toContain('FOR UPDATE')
    expect(firstExec.fragment).toContain('tenant_id')
    expect(firstExec.fragment).toContain('patient_id')
  })

  it('throws when a draft record is not found / wrong tenant', async () => {
    // Lock returns zero rows.
    txState.executeResponses.push({ rows: [] })

    await expect(
      finalizeEncounter({
        tenantId,
        userId,
        encounterId,
        patientId,
        practitionerId,
        cart: adhocCart,
        draftRecordIds: ['00000000-0000-0000-0000-00000000d004'],
        financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
        consents: [],
      }),
    ).rejects.toThrow(/não foram encontrados|não pertence/)
  })

  it('throws when a draft is already past draft/planned (e.g. approved)', async () => {
    txState.executeResponses.push({
      rows: [
        {
          id: '00000000-0000-0000-0000-00000000d005',
          tenant_id: tenantId,
          patient_id: patientId,
          status: 'approved', // not draft / planned
          planned_snapshot: null,
        },
      ],
    })

    await expect(
      finalizeEncounter({
        tenantId,
        userId,
        encounterId,
        patientId,
        practitionerId,
        cart: adhocCart,
        draftRecordIds: ['00000000-0000-0000-0000-00000000d005'],
        financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
        consents: [],
      }),
    ).rejects.toThrow(/já está em estado/)
  })

  it('uses createFinancialEntry helper, not a raw insert (Patch P1)', async () => {
    const draftId = '00000000-0000-0000-0000-00000000d006'
    txState.executeResponses.push({
      rows: [{ id: draftId, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null }],
    })

    await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftId],
      financialPlan: { totalAmount: '800.00', installmentCount: 3, paymentMethod: 'pix', notes: 'demo' },
      consents: [],
    })

    expect(createFinancialEntryMock).toHaveBeenCalledOnce()
    const [tId, uId, data] = createFinancialEntryMock.mock.calls[0]
    expect(tId).toBe(tenantId)
    expect(uId).toBe(userId)
    expect(data).toMatchObject({
      patientId,
      totalAmount: 800,
      installmentCount: 3,
      notes: 'demo',
    })

    // And no direct insert into financialEntries.
    const feInsert = txState.insertCalls.find((c) => c.table === 'financialEntries')
    expect(feInsert).toBeUndefined()
  })

  it('finalizes drafts IN PLACE — UPDATEs procedure_records, does NOT insert new ones (Patch P1)', async () => {
    const draftId = '00000000-0000-0000-0000-00000000d007'
    txState.executeResponses.push({
      rows: [{ id: draftId, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: { from: 'wizard' } }],
    })

    await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftId],
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    const recordUpdates = txState.updateCalls.filter((c) => c.table === 'procedureRecords')
    expect(recordUpdates).toHaveLength(1)
    const u = recordUpdates[0]
    expect(u.set.status).toBe('approved')
    expect(u.set.approvedAt).toBeInstanceOf(Date)
    expect(u.set.sessionsTotal).toBe(1)
    expect(u.set.financialPlan).toMatchObject({ totalAmount: '800.00' })
    // The encounterId set on the record matches what the caller passed
    // (FIX A: the wizard's URL UUID, not an internally-generated one).
    expect(u.set.encounterId).toBe(encounterId)

    // CRITICAL (Patch P1): plannedSnapshot must NOT be in the SET payload.
    // The wizard wrote it during step 2/3 and we preserve whatever's there.
    expect(u.set).not.toHaveProperty('plannedSnapshot')
    expect(u.set).not.toHaveProperty('planned_snapshot')

    // And no fresh procedure_records INSERT happened.
    const recordInsert = txState.insertCalls.find((c) => c.table === 'procedureRecords')
    expect(recordInsert).toBeUndefined()
  })

  it('multi-line cart: plannedSnapshot survives finalization on every record', async () => {
    const draftIds = [
      '00000000-0000-0000-0000-00000000d010',
      '00000000-0000-0000-0000-00000000d011',
    ]
    txState.executeResponses.push({
      rows: [
        { id: draftIds[0], tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: { line: 0, payload: 'a' } },
        { id: draftIds[1], tenant_id: tenantId, patient_id: patientId, status: 'planned', planned_snapshot: { line: 1, payload: 'b' } },
      ],
    })

    const result = await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: multiLineCart,
      draftRecordIds: draftIds,
      financialPlan: { totalAmount: '2400.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    expect(result.procedureRecordIds).toEqual(draftIds)
    // Same number of UPDATEs as draft records — one per line.
    const recordUpdates = txState.updateCalls.filter((c) => c.table === 'procedureRecords')
    expect(recordUpdates).toHaveLength(2)
    // Neither update touches plannedSnapshot — the wizard's payload survives.
    for (const u of recordUpdates) {
      expect(u.set).not.toHaveProperty('plannedSnapshot')
      expect(u.set).not.toHaveProperty('planned_snapshot')
    }
    // sessionsTotal is per-line.
    expect(recordUpdates[0].set.sessionsTotal).toBe(1)
    expect(recordUpdates[1].set.sessionsTotal).toBe(4)
  })

  it('writes one consent acceptance row per (draftRecord × consent)', async () => {
    const draftIds = [
      '00000000-0000-0000-0000-00000000d020',
      '00000000-0000-0000-0000-00000000d021',
    ]
    txState.executeResponses.push({
      rows: [
        { id: draftIds[0], tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null },
        { id: draftIds[1], tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null },
      ],
    })

    await finalizeEncounter({
      tenantId,
      userId,
      encounterId,
      patientId,
      practitionerId,
      cart: multiLineCart,
      draftRecordIds: draftIds,
      financialPlan: { totalAmount: '2400.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [
        {
          consentTemplateId: '00000000-0000-0000-0000-0000000000c1',
          signatureData: 'sig',
          contentSnapshot: 'snap',
          contentHash: 'hash',
          acceptanceMethod: 'signature',
        },
        {
          consentTemplateId: '00000000-0000-0000-0000-0000000000c2',
          signatureData: 'sig2',
          contentSnapshot: 'snap2',
          contentHash: 'hash2',
          acceptanceMethod: 'checkbox',
        },
      ],
    })

    const consentInserts = txState.insertCalls.filter((c) => c.table === 'consentAcceptances')
    expect(consentInserts).toHaveLength(4) // 2 records × 2 consents
    // Every acceptance is tied to one of our draft record ids.
    for (const c of consentInserts) {
      expect(draftIds).toContain(c.values.procedureRecordId)
    }
  })

  // FIX A: the caller now owns the encounterId — passing the same id twice
  // is a no-op at the signature level. The unit test harness doesn't enforce
  // DB-level uniqueness; this guards against a future refactor that might
  // sneak back an internal `crypto.randomUUID()` (which would silently make
  // the id different on each call and break the wizard → step 5 handoff).
  it('accepts the same encounterId on repeat calls without throwing (signature-level)', async () => {
    const draftIdA = '00000000-0000-0000-0000-00000000d030'
    const draftIdB = '00000000-0000-0000-0000-00000000d031'
    // Order matches the tx.execute call sequence per invocation:
    //   (1) FOR UPDATE lock → rows of the locked draft
    //   (2) UPDATE financial_entries back-fill → no rows
    // and the same pair for the second call.
    txState.executeResponses.push({
      rows: [{ id: draftIdA, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null }],
    })
    txState.executeResponses.push({ rows: [] })
    txState.executeResponses.push({
      rows: [{ id: draftIdB, tenant_id: tenantId, patient_id: patientId, status: 'draft', planned_snapshot: null }],
    })
    txState.executeResponses.push({ rows: [] })

    const sharedId = '00000000-0000-0000-0000-0000000000a2'

    const first = await finalizeEncounter({
      tenantId,
      userId,
      encounterId: sharedId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftIdA],
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })
    const second = await finalizeEncounter({
      tenantId,
      userId,
      encounterId: sharedId,
      patientId,
      practitionerId,
      cart: adhocCart,
      draftRecordIds: [draftIdB],
      financialPlan: { totalAmount: '800.00', installmentCount: 1, paymentMethod: 'pix' },
      consents: [],
    })

    expect(first.encounterId).toBe(sharedId)
    expect(second.encounterId).toBe(sharedId)
  })
})

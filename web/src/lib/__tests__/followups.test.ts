import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup ──────────────────────────────────────────────────────
//
// We mock `@/db/client` with a tiny in-memory transaction harness so we can
// drive `recordFollowup` end-to-end and assert:
//   1. A row is inserted into procedure_followups.
//   2. procedure_records.last_contacted_at is always updated.
//   3. When outcome === 'desistiu' (and status is allowed), the procedure
//      record is cancelled (status='cancelled', cancellationReason='patient_declined',
//      cancelledAt set).
//   4. When outcome === 'desistiu' AND previous status was 'approved', linked
//      financial entries and their installments are also cancelled.
//   5. When outcome === 'desistiu' and the procedure status is NOT in
//      ('planned', 'approved'), we throw and write nothing.
//   6. When the procedure does not belong to the caller's tenant, we throw.
//
// vi.mock factories are hoisted above any top-level `const` here, so all
// shared state lives inside `vi.hoisted()` — that block runs at hoist time.

const { txState, TABLE_TOKENS } = vi.hoisted(() => {
  interface UpdateCall {
    table: 'procedureRecords' | 'financialEntries' | 'installments' | 'unknown'
    values: Record<string, unknown>
  }
  interface TxState {
    selectResult: Array<{ id: string; tenantId: string; status: string }>
    insertedFollowups: Array<Record<string, unknown>>
    updates: UpdateCall[]
    // Returned from update(financialEntries).returning() — used to drive the
    // installment-cleanup loop. Defaults to empty.
    cancelledEntryIds: Array<{ id: string }>
  }
  const txState: TxState = {
    selectResult: [],
    insertedFollowups: [],
    updates: [],
    cancelledEntryIds: [],
  }
  const TABLE_TOKENS = {
    procedureRecords: { __table: 'procedureRecords' },
    financialEntries: { __table: 'financialEntries' },
    installments: { __table: 'installments' },
  } as const
  return { txState, TABLE_TOKENS }
})

type UpdateCallTable =
  | 'procedureRecords'
  | 'financialEntries'
  | 'installments'
  | 'unknown'

function resetTx(
  initial: typeof txState.selectResult,
  opts: { cancelledEntryIds?: Array<{ id: string }> } = {},
) {
  txState.selectResult = initial
  txState.insertedFollowups = []
  txState.updates = []
  txState.cancelledEntryIds = opts.cancelledEntryIds ?? []
}

vi.mock('@/db/client', () => {
  function tagTable(token: unknown): UpdateCallTable {
    if (token === TABLE_TOKENS.procedureRecords) return 'procedureRecords'
    if (token === TABLE_TOKENS.financialEntries) return 'financialEntries'
    if (token === TABLE_TOKENS.installments) return 'installments'
    return 'unknown'
  }

  function makeTx() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(txState.selectResult),
          }),
        }),
      }),
      insert: () => ({
        values: (vals: Record<string, unknown>) => ({
          returning: () => {
            txState.insertedFollowups.push(vals)
            return Promise.resolve([{ id: 'followup-1' }])
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (vals: Record<string, unknown>) => {
          const tableTag = tagTable(table)
          const call = { table: tableTag, values: vals }
          return {
            where: () => {
              // financialEntries updates use .returning() — installments and
              // procedureRecords don't. We mimic both shapes by returning a
              // thenable that also exposes .returning(). Only one of these
              // fires per call: .returning() is invoked for financialEntries,
              // otherwise `await` triggers .then for the other two.
              return {
                then: (
                  resolve: (value: unknown) => unknown,
                  reject?: (reason: unknown) => unknown,
                ) => {
                  txState.updates.push(call)
                  return Promise.resolve(undefined).then(resolve, reject)
                },
                returning: () => {
                  txState.updates.push(call)
                  if (tableTag === 'financialEntries') {
                    return Promise.resolve(txState.cancelledEntryIds)
                  }
                  return Promise.resolve([])
                },
              }
            },
          }
        },
      }),
    }
  }

  return {
    db: {
      transaction: async (
        fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>,
      ) => fn(makeTx()),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    },
  }
})

vi.mock('@/db/schema', () => ({
  procedureFollowups: { id: 'id' },
  procedureRecords: Object.assign(TABLE_TOKENS.procedureRecords, {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    deletedAt: 'deleted_at',
  }),
  financialEntries: Object.assign(TABLE_TOKENS.financialEntries, {
    id: 'id',
    tenantId: 'tenant_id',
    procedureRecordId: 'procedure_record_id',
    deletedAt: 'deleted_at',
  }),
  installments: Object.assign(TABLE_TOKENS.installments, {
    id: 'id',
    tenantId: 'tenant_id',
    financialEntryId: 'financial_entry_id',
  }),
}))

// drizzle-orm operators are passed straight through to our stub `where`
// clauses (which we never inspect), so the simplest stub is fine.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
}))

import { recordFollowup, snoozeProcedure } from '../followups'

describe('recordFollowup', () => {
  beforeEach(() => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status: 'planned' }])
  })

  it('inserts a followup row and updates last_contacted_at on a normal outcome', async () => {
    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'whatsapp',
      outcome: 'sem_resposta',
      notes: 'Tentei pelo WhatsApp',
    })

    expect(result.followupId).toBe('followup-1')
    expect(result.cancelledProcedure).toBe(false)
    expect(result.previousStatus).toBe('planned')

    expect(txState.insertedFollowups).toHaveLength(1)
    const inserted = txState.insertedFollowups[0]
    expect(inserted).toMatchObject({
      tenantId: 'tenant-1',
      procedureRecordId: 'proc-1',
      contactedBy: 'user-1',
      channel: 'whatsapp',
      outcome: 'sem_resposta',
      notes: 'Tentei pelo WhatsApp',
    })
    expect(inserted.contactedAt).toBeInstanceOf(Date)

    // Exactly one update on procedure_records — last_contacted_at + updated_at,
    // no status change, no financial cleanup.
    expect(txState.updates).toHaveLength(1)
    expect(txState.updates[0].table).toBe('procedureRecords')
    expect(txState.updates[0].values).toMatchObject({
      lastContactedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(txState.updates[0].values).not.toHaveProperty('status')
  })

  it('cancels the procedure when outcome === "desistiu" on a planned procedure', async () => {
    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'call',
      outcome: 'desistiu',
    })

    expect(result.cancelledProcedure).toBe(true)
    expect(result.previousStatus).toBe('planned')
    expect(txState.insertedFollowups).toHaveLength(1)

    // Single update on procedure_records (cancellation fields + last_contacted_at).
    // No financial cleanup because previous status was 'planned' (no entries yet).
    expect(txState.updates).toHaveLength(1)
    expect(txState.updates[0].table).toBe('procedureRecords')
    expect(txState.updates[0].values).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'patient_declined',
      lastContactedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(txState.updates[0].values.cancelledAt).toBeInstanceOf(Date)
  })

  it('cancels linked financial entries and installments when desistiu on an approved procedure', async () => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status: 'approved' }], {
      cancelledEntryIds: [{ id: 'entry-1' }, { id: 'entry-2' }],
    })

    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'call',
      outcome: 'desistiu',
    })

    expect(result.cancelledProcedure).toBe(true)
    expect(result.previousStatus).toBe('approved')

    // Expect updates in order: procedureRecords (cancel), financialEntries
    // (cancel + returning ids), then one installments update per returned id.
    expect(txState.updates.map((u) => u.table)).toEqual([
      'procedureRecords',
      'financialEntries',
      'installments',
      'installments',
    ])
    expect(txState.updates[1].values).toMatchObject({
      status: 'cancelled',
      updatedAt: expect.any(Date),
    })
    expect(txState.updates[2].values).toMatchObject({ status: 'cancelled' })
    expect(txState.updates[3].values).toMatchObject({ status: 'cancelled' })
  })

  it('does not touch installments when desistiu on approved with no financial entries', async () => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status: 'approved' }], {
      cancelledEntryIds: [],
    })

    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'call',
      outcome: 'desistiu',
    })

    expect(result.cancelledProcedure).toBe(true)
    // procedureRecords update + financialEntries update (returning empty) + no installments.
    expect(txState.updates.map((u) => u.table)).toEqual([
      'procedureRecords',
      'financialEntries',
    ])
  })

  it.each(['cancelled', 'executed', 'draft'] as const)(
    'rejects desistiu when previous status is %s, writing nothing',
    async (status) => {
      resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status }])
      await expect(
        recordFollowup({
          tenantId: 'tenant-1',
          contactedBy: 'user-1',
          procedureRecordId: 'proc-1',
          channel: 'call',
          outcome: 'desistiu',
        }),
      ).rejects.toThrow('Procedure cannot be cancelled from current status')

      expect(txState.insertedFollowups).toHaveLength(0)
      expect(txState.updates).toHaveLength(0)
    },
  )

  it('allows non-desistiu outcomes regardless of procedure status', async () => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status: 'executed' }])
    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'whatsapp',
      outcome: 'sem_resposta',
    })
    expect(result.cancelledProcedure).toBe(false)
    expect(result.previousStatus).toBe('executed')
    expect(txState.insertedFollowups).toHaveLength(1)
  })

  it('normalizes missing notes to null when inserting', async () => {
    await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'in_person',
      outcome: 'agendou',
    })

    expect(txState.insertedFollowups[0]).toMatchObject({ notes: null })
  })

  it('throws when the procedure does not exist', async () => {
    resetTx([])
    await expect(
      recordFollowup({
        tenantId: 'tenant-1',
        contactedBy: 'user-1',
        procedureRecordId: 'missing',
        channel: 'whatsapp',
        outcome: 'sem_resposta',
      }),
    ).rejects.toThrow('Procedure not found')
    expect(txState.insertedFollowups).toHaveLength(0)
    expect(txState.updates).toHaveLength(0)
  })

  it('throws when the procedure belongs to a different tenant', async () => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-other', status: 'planned' }])
    await expect(
      recordFollowup({
        tenantId: 'tenant-1',
        contactedBy: 'user-1',
        procedureRecordId: 'proc-1',
        channel: 'whatsapp',
        outcome: 'sem_resposta',
      }),
    ).rejects.toThrow('Procedure not found')
    expect(txState.insertedFollowups).toHaveLength(0)
    expect(txState.updates).toHaveLength(0)
  })
})

describe('snoozeProcedure', () => {
  // snoozeProcedure uses db.update directly (not inside a transaction). The
  // mocked `db.update` returns an empty array, so we just confirm the result
  // surface here. Integration testing of the WHERE clause happens at the
  // route level / e2e level.
  it('returns false when no rows were updated', async () => {
    const ok = await snoozeProcedure({
      tenantId: 'tenant-1',
      procedureRecordId: 'proc-1',
      until: '2026-06-01',
    })
    expect(ok).toBe(false)
  })

  it('accepts a null `until` to clear a snooze', async () => {
    const ok = await snoozeProcedure({
      tenantId: 'tenant-1',
      procedureRecordId: 'proc-1',
      until: null,
    })
    expect(ok).toBe(false)
  })
})

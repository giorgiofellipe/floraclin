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
//   4. When outcome === 'desistiu' AND previous status was 'approved', the
//      linked financials are cancelled through cancelLinkedFinancials.
//   5. When outcome === 'desistiu' and the procedure status is NOT in
//      ('planned', 'approved'), we throw and write nothing.
//   6. When the procedure does not belong to the caller's tenant, we throw.
//
// vi.mock factories are hoisted above any top-level `const` here, so all
// shared state lives inside `vi.hoisted()` — that block runs at hoist time.

const { txState, TABLE_TOKENS } = vi.hoisted(() => {
  interface UpdateCall {
    table: 'procedureRecords' | 'unknown'
    values: Record<string, unknown>
    where?: unknown
  }
  interface TxState {
    selectResult: Array<{ id: string; tenantId: string; status: string }>
    insertedFollowups: Array<Record<string, unknown>>
    updates: UpdateCall[]
  }
  const txState: TxState = {
    selectResult: [],
    insertedFollowups: [],
    updates: [],
  }
  const TABLE_TOKENS = {
    procedureRecords: { __table: 'procedureRecords' },
  } as const
  return { txState, TABLE_TOKENS }
})

type UpdateCallTable = 'procedureRecords' | 'unknown'

function resetTx(initial: typeof txState.selectResult) {
  txState.selectResult = initial
  txState.insertedFollowups = []
  txState.updates = []
}

const cancelLinkedFinancialsMock = vi.fn()
vi.mock('@/db/queries/financial', () => ({
  cancelLinkedFinancials: (...args: unknown[]) => cancelLinkedFinancialsMock(...args),
}))

vi.mock('@/lib/tenant', async () => {
  const { db } = await import('@/db/client')
  return { withTransaction: (fn: (tx: unknown) => unknown) => db.transaction(fn as never) }
})

vi.mock('@/db/client', () => {
  function tagTable(token: unknown): UpdateCallTable {
    if (token === TABLE_TOKENS.procedureRecords) return 'procedureRecords'
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
          const call: { table: UpdateCallTable; values: Record<string, unknown>; where?: unknown } = { table: tableTag, values: vals }
          return {
            where: (condition: unknown) => {
              call.where = condition
              return {
                then: (
                  resolve: (value: unknown) => unknown,
                  reject?: (reason: unknown) => unknown,
                ) => {
                  txState.updates.push(call)
                  return Promise.resolve(undefined).then(resolve, reject)
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
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
}))

import { recordFollowup, snoozeProcedure } from '../followups'

describe('recordFollowup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(cancelLinkedFinancialsMock).not.toHaveBeenCalled()
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

  it('cancels the linked financials through cancelLinkedFinancials, on the same transaction, when desistiu on an approved procedure', async () => {
    resetTx([{ id: 'proc-1', tenantId: 'tenant-1', status: 'approved' }])

    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'call',
      outcome: 'desistiu',
    })

    expect(result.cancelledProcedure).toBe(true)
    expect(result.previousStatus).toBe('approved')
    expect(txState.updates.map((u) => u.table)).toEqual(['procedureRecords'])
    expect(cancelLinkedFinancialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.any(Function) }),
      'tenant-1',
      'user-1',
      'proc-1',
      'Paciente desistiu do procedimento',
    )
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

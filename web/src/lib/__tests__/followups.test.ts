import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup ──────────────────────────────────────────────────────
//
// We mock `@/db/client` with a tiny in-memory transaction harness so we can
// drive `recordFollowup` end-to-end and assert:
//   1. A row is inserted into procedure_followups.
//   2. procedure_records.last_contacted_at is always updated.
//   3. When outcome === 'desistiu', the procedure record is cancelled
//      (status='cancelled', cancellationReason='patient_declined', cancelledAt set).
//   4. When the procedure does not belong to the caller's tenant, we throw.

interface TxState {
  selectResult: Array<{ id: string; tenantId: string; status: string }>
  insertedFollowups: Array<Record<string, unknown>>
  procedureUpdates: Array<Record<string, unknown>>
}

const txState: TxState = {
  selectResult: [],
  insertedFollowups: [],
  procedureUpdates: [],
}

function resetTx(initial: TxState['selectResult']) {
  txState.selectResult = initial
  txState.insertedFollowups = []
  txState.procedureUpdates = []
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
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          txState.procedureUpdates.push(vals)
          return Promise.resolve()
        },
      }),
    }),
  }
}

vi.mock('@/db/client', () => ({
  db: {
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return fn(makeTx())
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  procedureFollowups: { id: 'id' },
  procedureRecords: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    deletedAt: 'deleted_at',
  },
}))

// drizzle-orm operators are passed straight through to our stub `where` clauses
// (which we never inspect), so the simplest stub is fine.
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

    // Exactly one update — last_contacted_at + updated_at, no status change.
    expect(txState.procedureUpdates).toHaveLength(1)
    expect(txState.procedureUpdates[0]).toMatchObject({
      lastContactedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(txState.procedureUpdates[0]).not.toHaveProperty('status')
  })

  it('cancels the procedure when outcome === "desistiu"', async () => {
    const result = await recordFollowup({
      tenantId: 'tenant-1',
      contactedBy: 'user-1',
      procedureRecordId: 'proc-1',
      channel: 'call',
      outcome: 'desistiu',
    })

    expect(result.cancelledProcedure).toBe(true)
    expect(txState.insertedFollowups).toHaveLength(1)

    // Single combined update: cancellation fields + last_contacted_at
    expect(txState.procedureUpdates).toHaveLength(1)
    const update = txState.procedureUpdates[0]
    expect(update).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'patient_declined',
      lastContactedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(update.cancelledAt).toBeInstanceOf(Date)
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
    expect(txState.procedureUpdates).toHaveLength(0)
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
    expect(txState.procedureUpdates).toHaveLength(0)
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

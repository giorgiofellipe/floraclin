import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chain, chainCapturing, isLock, routedTx, selectSql, tableOf, whereParams, type Capture } from '@/tests/mocks/drizzle-tx'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

// financial.ts imports these unconditionally at module scope for its Meta
// side effects, even though uncancelEntries never calls them.
const enqueueMetaEventMock = vi.fn()
const resolveMetaEventPrerequisitesMock = vi.fn()
const claimAndSendPendingEventMock = vi.fn()
vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: (...args: unknown[]) => enqueueMetaEventMock(...args),
  resolveMetaEventPrerequisites: (...args: unknown[]) => resolveMetaEventPrerequisitesMock(...args),
  claimAndSendPendingEvent: (...args: unknown[]) => claimAndSendPendingEventMock(...args),
}))

const resolveProspectForPatientMock = vi.fn()
vi.mock('@/lib/meta/resolve-prospect', () => ({
  resolveProspectForPatient: (...args: unknown[]) => resolveProspectForPatientMock(...args),
}))

const reportSideEffectFailureMock = vi.fn()
vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const ENTRY_ID_2 = '00000000-0000-0000-0000-00000000e002'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'
const ORIGINAL_ENTRY_ID = '00000000-0000-0000-0000-00000000e0aa'

function makeTx() {
  return { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }
}

const cancelledInstallment = {
  id: INSTALLMENT_ID,
  financialEntryId: ENTRY_ID,
  amount: '750.00',
  dueDate: '2026-06-30',
  appliedFineType: 'percentage',
  appliedFineValue: '2.00',
  appliedInterestRate: '1.00',
  appliedGracePeriodDays: 0,
}

describe('uncancelEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores a cancelled entry: its cancelled installments go to pending, the time spent cancelled becomes a penalty pause, and the status is recomputed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'))
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    const earlierPause = { from: '2026-04-01T15:00:00.000Z', to: '2026-04-05T15:00:00.000Z' }
    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: false }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(
      chain([
        {
          ...cancelledInstallment,
          cancelledAt: new Date('2026-05-25T15:00:00.000Z'),
          penaltyPauses: [earlierPause],
        },
      ]),
    ) // cancelled installments
    tx.select.mockReturnValueOnce(chain([])) // live payments

    const installmentsUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentsUpdate)) // installment cancelled -> pending

    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    const entryUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, entryUpdate)) // financialEntries status

    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    const result = await uncancelEntries(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      reason: 'Cobrança cancelada por engano',
    })

    expect(result).toEqual({ uncancelledCount: 1 })
    expect(installmentsUpdate.value).toMatchObject({
      status: 'pending',
      cancelledAt: null,
      penaltyPauses: [earlierPause, { from: '2026-05-25T15:00:00.000Z', to: '2026-09-03T15:00:00.000Z' }],
    })
    expect(entryUpdate.value).toMatchObject({ status: 'pending' })
  })

  // Legacy cancels also cancelled rows whose principal was already paid. Back
  // to pending, they would be collected a second time.
  it('restores a cancelled installment whose replayed payments settle the principal as paid', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'))
    const { uncancelEntries } = await import('../financial')
    const { installments } = await import('@/db/schema')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    const installmentUpdate: { value?: unknown } = {}
    tx.update.mockImplementation((table: unknown) =>
      table === installments ? chainCapturing(undefined, installmentUpdate) : chain(undefined),
    )
    tx.insert.mockReturnValue(chain(undefined))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: false }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(
      chain([{ ...cancelledInstallment, cancelledAt: new Date('2026-05-25T15:00:00.000Z'), penaltyPauses: [] }]),
    ) // cancelled installments
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          installmentId: INSTALLMENT_ID,
          amount: '750.00',
          paidAt: '2026-05-20T15:00:00.000Z',
          recordedAt: '2026-05-20T15:00:00.000Z',
        },
      ]),
    ) // live payments
    tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '750.00' }])) // updateEntryStatus

    await uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })

    expect(installmentUpdate.value).toMatchObject({
      status: 'paid',
      cancelledAt: null,
      penaltyPauses: [{ from: '2026-05-25T15:00:00.000Z', to: '2026-09-03T15:00:00.000Z' }],
    })
  })

  it('audits the status the recompute wrote and the pause each installment got', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'))
    const { uncancelEntries } = await import('../financial')
    const { auditLogs, financialEntries, installments, paymentRecords } = await import('@/db/schema')
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op !== 'select') return undefined
      const fields = Object.keys((q.fields as object | undefined) ?? {})
      if (table === financialEntries) return [{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: false }]
      if (table === paymentRecords) {
        return [{ id: 'p1', installmentId: INSTALLMENT_ID, amount: '100.00', paidAt: '2026-05-20T15:00:00.000Z', recordedAt: '2026-05-20T15:00:00.000Z' }]
      }
      if (table !== installments) return []
      if (isLock(q)) return [{ id: INSTALLMENT_ID, financialEntryId: ENTRY_ID, status: 'cancelled' }]
      if (fields.includes('cancelledAt')) {
        return [{ ...cancelledInstallment, cancelledAt: new Date('2026-05-25T15:00:00.000Z'), penaltyPauses: [] }]
      }
      return [{ status: 'pending', amountPaid: '100.00' }]
    })
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    await uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'Engano' })

    const audit = log.find((q) => q.op === 'insert' && tableOf(q) === auditLogs)
    expect(audit?.capture.value).toMatchObject({
      entityId: ENTRY_ID,
      changes: {
        status: { old: 'cancelled', new: 'partial' },
        penaltyPauses: {
          old: null,
          new: [{ installmentId: INSTALLMENT_ID, from: '2026-05-25T15:00:00.000Z', to: '2026-09-03T15:00:00.000Z' }],
        },
      },
    })
  })

  it('throws ENTRY_NOT_CANCELLED when a selected entry is not cancelled', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }])) // entries

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_CANCELLED' })
  })

  it('throws ENTRY_NOT_FOUND when an entry is not found', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([])) // entries: none found for this tenant

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
  })

  // A replacement loses its renegotiation_links rows when it is cancelled, so
  // the entry's own flag is the record that it was one. Anything else the
  // path reads comes back empty, so only that flag can refuse it.
  it('throws ENTRY_FROM_RENEGOTIATION for a renegotiation replacement', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: true }])) // entries
    tx.select.mockReturnValue(chain([]))
    tx.update.mockReturnValue(chain(undefined))
    tx.insert.mockReturnValue(chain(undefined))

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_FROM_RENEGOTIATION' })
  })

  // Reactivating the original side of a still-live renegotiation would
  // make the same debt collectible twice, through both the original and its
  // replacement.
  it('throws ENTRY_HAS_REPLACEMENT when a renegotiation_links row has the entry as originalEntryId', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([{ originalEntryId: ENTRY_ID }])) // liveReplacements

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_HAS_REPLACEMENT' })
  })

  it('writes one audit log per entry, carrying the reason', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(
      chain([
        { id: ENTRY_ID, status: 'cancelled' },
        { id: ENTRY_ID_2, status: 'cancelled' },
      ])
    ) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(chain([])) // cancelled installments: none

    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // entry 1: updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined))
    const audit1: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, audit1))

    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // entry 2: updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined))
    const audit2: { value?: unknown } = {}
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, audit2))

    const result = await uncancelEntries(TENANT, USER_ID, {
      entryIds: [ENTRY_ID, ENTRY_ID_2],
      reason: 'Engano do financeiro',
    })

    expect(result).toEqual({ uncancelledCount: 2 })
    expect(tx.insert).toHaveBeenCalledTimes(2)
    expect(audit1.value).toMatchObject({
      entityId: ENTRY_ID,
      changes: { reason: { old: null, new: 'Engano do financeiro' } },
    })
    expect(audit2.value).toMatchObject({
      entityId: ENTRY_ID_2,
      changes: { reason: { old: null, new: 'Engano do financeiro' } },
    })
  })

  it('reads entry status only behind the installment lock bulkCancelEntries takes, in id order', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    const lock: Capture = {}
    tx.select.mockReturnValueOnce(chain([], lock)) // installment lock
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(chain([])) // cancelled installments: none
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries status
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    await uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })

    expect(selectSql(tx.select.mock.calls[0][0], lock)).toMatch(
      /from "floraclin"\."installments"[\s\S]*order by "floraclin"\."installments"\."id"[\s\S]*for update/i,
    )
  })
})

describe('bulkCancelEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T15:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stamps cancelledAt on the installments it cancels, so the pause can start there', async () => {
    const { bulkCancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // renegotiation links
    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.update.mockReturnValueOnce(chain(undefined)) // entries cancelled
    const installmentsUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentsUpdate)) // installments cancelled
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    await bulkCancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })

    expect(installmentsUpdate.value).toMatchObject({
      status: 'cancelled',
      cancelledAt: new Date('2026-05-25T15:00:00.000Z'),
    })
  })

  it('turns the time a renegotiated original spent cancelled into a penalty pause when its replacement is cancelled', async () => {
    const { bulkCancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }])) // entries
    tx.select.mockReturnValueOnce(
      chain([{ originalEntryId: ORIGINAL_ENTRY_ID, newEntryId: ENTRY_ID }]),
    ) // renegotiation links
    tx.select.mockReturnValueOnce(chain([])) // installment lock
    tx.select.mockReturnValueOnce(chain([{ status: 'cancelled', amountPaid: '0' }])) // original installments
    tx.select.mockReturnValueOnce(
      chain([
        {
          ...cancelledInstallment,
          financialEntryId: ORIGINAL_ENTRY_ID,
          cancelledAt: new Date('2026-05-10T15:00:00.000Z'),
          penaltyPauses: [],
        },
      ]),
    ) // original cancelled installments
    tx.select.mockReturnValueOnce(chain([])) // their live payments
    const restore: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, restore)) // original installment -> pending
    tx.update.mockReturnValue(chain(undefined))
    tx.insert.mockReturnValue(chain(undefined))
    tx.delete = vi.fn().mockReturnValue(chain(undefined))

    await bulkCancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })

    expect(restore.value).toMatchObject({
      status: 'pending',
      cancelledAt: null,
      penaltyPauses: [{ from: '2026-05-10T15:00:00.000Z', to: '2026-05-25T15:00:00.000Z' }],
    })
  })
})

describe('cancelLinkedFinancials', () => {
  const PROCEDURE_ID = '00000000-0000-0000-0000-0000000000c1'
  const RENEGOTIATED_ENTRY = '00000000-0000-0000-0000-00000000e0bb'
  const PENDING_ID = '00000000-0000-0000-0000-00000000i0a1'
  const CANCELLED_ID = '00000000-0000-0000-0000-00000000i0a2'
  const PAID_ID = '00000000-0000-0000-0000-00000000i0a3'
  const RENEGOTIATED_INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i0b1'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * A procedure with a live entry (one pending, one already cancelled and one
   * paid installment) and an entry a renegotiation already replaced. Queries
   * resolve by table, and every one is logged in call order.
   */
  async function cancelProcedureFinancials() {
    const { cancelLinkedFinancials } = await import('../financial')
    const { financialEntries, installments, auditLogs } = await import('@/db/schema')
    const entries = [
      { id: ENTRY_ID, status: 'partial' },
      { id: RENEGOTIATED_ENTRY, status: 'renegotiated' },
    ]
    const installmentRows = [
      { id: PENDING_ID, financialEntryId: ENTRY_ID, status: 'pending' },
      { id: CANCELLED_ID, financialEntryId: ENTRY_ID, status: 'cancelled' },
      { id: PAID_ID, financialEntryId: ENTRY_ID, status: 'paid' },
      { id: RENEGOTIATED_INSTALLMENT_ID, financialEntryId: RENEGOTIATED_ENTRY, status: 'cancelled' },
    ]
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'select') return table === financialEntries ? entries : installmentRows
      if (q.op === 'update' && table === financialEntries) return entries
      return undefined
    })

    await cancelLinkedFinancials(tx as never, TENANT, USER_ID, PROCEDURE_ID, 'Paciente desistiu')

    return {
      log,
      entryUpdates: log.filter((q) => q.op === 'update' && tableOf(q) === financialEntries),
      installmentUpdates: log.filter((q) => q.op === 'update' && tableOf(q) === installments),
      audits: log.filter((q) => q.op === 'insert' && tableOf(q) === auditLogs),
    }
  }

  it('cancels only pending installments: an already cancelled one keeps its cancelled_at and a paid one stays paid', async () => {
    const { installmentUpdates } = await cancelProcedureFinancials()

    expect(installmentUpdates).toHaveLength(1)
    expect(installmentUpdates[0].capture.value).toMatchObject({
      status: 'cancelled',
      cancelledAt: new Date('2026-09-03T15:00:00.000Z'),
    })
    const params = whereParams(installmentUpdates[0].capture)
    expect(params).toContain(PENDING_ID)
    expect(params).not.toContain(CANCELLED_ID)
    expect(params).not.toContain(PAID_ID)
    expect(params).not.toContain(RENEGOTIATED_INSTALLMENT_ID)
  })

  it('leaves an entry a renegotiation replaced renegotiated', async () => {
    const { entryUpdates } = await cancelProcedureFinancials()

    expect(entryUpdates).toHaveLength(1)
    expect(entryUpdates[0].capture.value).toMatchObject({ status: 'cancelled' })
    expect(whereParams(entryUpdates[0].capture)).toContain(ENTRY_ID)
    expect(whereParams(entryUpdates[0].capture)).not.toContain(RENEGOTIATED_ENTRY)
  })

  it('locks the installments in id order before it writes the entry', async () => {
    const { log } = await cancelProcedureFinancials()

    const lockAt = log.findIndex(
      (q) => isLock(q) && /from "floraclin"\."installments"[\s\S]*order by "floraclin"\."installments"\."id"[\s\S]*for update/i.test(selectSql(q.fields, q.capture)),
    )
    const entryWriteAt = log.findIndex((q) => q.op === 'update')
    expect(lockAt).toBeGreaterThanOrEqual(0)
    expect(lockAt).toBeLessThan(entryWriteAt)
  })

  it('writes one financial_entry audit row per cancelled entry, with the old status and the reason', async () => {
    const { audits } = await cancelProcedureFinancials()

    expect(audits.map((a) => a.capture.value)).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        userId: USER_ID,
        action: 'update',
        entityType: 'financial_entry',
        entityId: ENTRY_ID,
        changes: {
          status: { old: 'partial', new: 'cancelled' },
          reason: { old: null, new: 'Paciente desistiu' },
        },
      }),
    ])
  })
})

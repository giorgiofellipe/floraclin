import { describe, it, expect, vi, beforeEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, copied from
// financial-meta.test.ts. Every method call returns the same proxy so any
// chain shape resolves to `result` when awaited.
function chain(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
        }
        return () => proxy
      },
    },
  )
  return proxy
}

// Like chain(), but also records the payload passed to .set() or .values(),
// copied from financial-bulk-pay.test.ts, so a test can assert on the write
// itself rather than just that a write happened.
function chainCapturing(result: unknown, capture: { value?: unknown }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
        }
        if (prop === 'set' || prop === 'values') {
          return (payload: unknown) => {
            capture.value = payload
            return proxy
          }
        }
        return () => proxy
      },
    },
  )
  return proxy
}

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

function makeTx() {
  return { select: vi.fn(), insert: vi.fn(), update: vi.fn() }
}

describe('uncancelEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores a cancelled entry: its cancelled installments go to pending and the status is recomputed', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(chain([])) // creationLogs

    const installmentsUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, installmentsUpdate)) // installments cancelled -> pending

    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    const entryUpdate: { value?: unknown } = {}
    tx.update.mockReturnValueOnce(chainCapturing(undefined, entryUpdate)) // financialEntries status

    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    const result = await uncancelEntries(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      reason: 'Cobrança cancelada por engano',
    })

    expect(result).toEqual({ uncancelledCount: 1 })
    expect(installmentsUpdate.value).toMatchObject({ status: 'pending' })
    expect(entryUpdate.value).toMatchObject({ status: 'pending' })
  })

  it('throws ENTRY_NOT_CANCELLED when a selected entry is not cancelled', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'pending' }])) // entries

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_CANCELLED' })
  })

  it('throws ENTRY_NOT_FOUND when an id belongs to another tenant', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // entries: none found for this tenant

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
  })

  // [AR-5] The replacement side of a cancelled renegotiation loses its
  // renegotiation_links rows on cancel, so its own creation log (written once,
  // in renegotiation.ts) is the only per-entry record that it was one.
  it('throws ENTRY_FROM_RENEGOTIATION when the entry is a renegotiation replacement', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(
      chain([{ entityId: ENTRY_ID, changes: { type: { old: null, new: 'renegotiation' } } }])
    ) // creationLogs

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_FROM_RENEGOTIATION' })
  })

  // [AR-5] Reactivating the original side of a still-live renegotiation would
  // make the same debt collectible twice, through both the original and its
  // replacement.
  it('throws ENTRY_HAS_REPLACEMENT when a renegotiation_links row has the entry as originalEntryId', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([{ originalEntryId: ENTRY_ID }])) // liveReplacements

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_HAS_REPLACEMENT' })
  })

  // [AR-5] Regression guard for the v1 mistake: bulkCancelEntries writes
  // `revertedOriginals` into every selected entry's own cancel log for the
  // whole batch, not per entry, so an ordinary charge cancelled beside a
  // renegotiated one must not be blocked by it. The generic chain() proxy
  // discards .where() arguments, so exercising the
  // `eq(auditLogs.action, 'create')` filter itself is impractical against
  // this mock harness; this test instead pins the decision logic to require
  // `changes.type.new === 'renegotiation'` and to ignore a `revertedOriginals`
  // field sitting alongside it, which is what keeps that filter meaningful.
  it('allows reactivating an ordinary entry whose audit trail carries a batch-wide revertedOriginals marker', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(
      chain([
        {
          entityId: ENTRY_ID,
          changes: {
            status: { old: 'pending', new: 'cancelled' },
            reason: { old: null, new: 'Cancelamento em lote' },
            revertedOriginals: { old: null, new: ['00000000-0000-0000-0000-00000000e999'] },
          },
        },
      ])
    ) // creationLogs

    tx.update.mockReturnValueOnce(chain(undefined)) // installments cancelled -> pending
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries status
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    const result = await uncancelEntries(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      reason: 'Cobrança cancelada por engano',
    })

    expect(result).toEqual({ uncancelledCount: 1 })
  })

  it('writes one audit log per entry, carrying the reason', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(
      chain([
        { id: ENTRY_ID, status: 'cancelled' },
        { id: ENTRY_ID_2, status: 'cancelled' },
      ])
    ) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(chain([])) // creationLogs

    tx.update.mockReturnValueOnce(chain(undefined)) // installments cancelled -> pending

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
})

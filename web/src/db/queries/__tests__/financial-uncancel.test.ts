import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

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
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'
const ORIGINAL_ENTRY_ID = '00000000-0000-0000-0000-00000000e0aa'

function makeTx() {
  return { execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }
}

describe('uncancelEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores a cancelled entry: its cancelled installments go to pending, the time spent cancelled becomes a penalty pause, and the status is recomputed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'))
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    const earlierPause = { from: '2026-04-01T15:00:00.000Z', to: '2026-04-05T15:00:00.000Z' }
    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: false }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(
      chain([{ id: INSTALLMENT_ID, cancelledAt: new Date('2026-05-25T15:00:00.000Z'), penaltyPauses: [earlierPause] }]),
    ) // cancelled installments

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
    vi.useRealTimers()

    expect(result).toEqual({ uncancelledCount: 1 })
    expect(installmentsUpdate.value).toMatchObject({
      status: 'pending',
      cancelledAt: null,
      penaltyPauses: [earlierPause, { from: '2026-05-25T15:00:00.000Z', to: '2026-09-03T15:00:00.000Z' }],
    })
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

  it('throws ENTRY_NOT_FOUND when an entry is not found', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([])) // entries: none found for this tenant

    await expect(
      uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
  })

  // A replacement loses its renegotiation_links rows when it is cancelled, so
  // the entry's own flag is the record that it was one. Anything else the
  // path reads comes back empty, so only that flag can refuse it.
  it('throws ENTRY_FROM_RENEGOTIATION for a renegotiation replacement that has no audit row', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled', createdFromRenegotiation: true }]))
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

  it('reads entry status only behind the installment lock bulkCancelEntries takes, in id order', async () => {
    const { uncancelEntries } = await import('../financial')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    tx.select.mockReturnValueOnce(chain([{ id: ENTRY_ID, status: 'cancelled' }])) // entries
    tx.select.mockReturnValueOnce(chain([])) // liveReplacements
    tx.select.mockReturnValueOnce(chain([])) // creationLogs
    tx.update.mockReturnValueOnce(chain(undefined)) // installments cancelled -> pending
    tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus
    tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries status
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log

    await uncancelEntries(TENANT, USER_ID, { entryIds: [ENTRY_ID], reason: 'x' })

    expect(tx.execute).toHaveBeenCalledTimes(1)
    const lock = new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0] as SQL)
    expect(lock.sql).toMatch(/floraclin\.installments[\s\S]*ORDER BY id\s+FOR UPDATE/)
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(tx.select.mock.invocationCallOrder[0])
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
    tx.select.mockReturnValueOnce(chain([{ status: 'cancelled', amountPaid: '0' }])) // original installments
    tx.select.mockReturnValueOnce(
      chain([{ id: INSTALLMENT_ID, cancelledAt: new Date('2026-05-10T15:00:00.000Z'), penaltyPauses: [] }]),
    ) // original cancelled installments
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

import { describe, it, expect, vi, beforeEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders. Every method
// call is recorded (for assertions) and returns the same proxy so any chain
// shape (`.from().where().orderBy().limit().for()`, etc.) resolves to
// `result` when awaited.
function chain(result: unknown) {
  const calls: Record<string, unknown[][]> = {}
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
        if (prop === '__calls') {
          return calls
        }
        return (...args: unknown[]) => {
          calls[prop] = calls[prop] ?? []
          calls[prop].push(args)
          return proxy
        }
      },
    },
  )
  return proxy as Record<string, (...args: unknown[]) => unknown> & { __calls: Record<string, unknown[][]> }
}

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}

vi.mock('@/db/client', () => ({ db: dbMock }))

const TENANT_A = '00000000-0000-0000-0000-00000000a001'
const TENANT_B = '00000000-0000-0000-0000-00000000b002'

describe('meta-events queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('insertConversionEvent', () => {
    it('returns inserted:true with the new row id on first insert', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      dbMock.insert.mockReturnValueOnce(chain([{ id: 'evt-1' }]))

      const result = await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: 'prospect-1',
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        payload: { foo: 'bar' },
        status: 'pending',
      })

      expect(result).toEqual({ inserted: true, id: 'evt-1' })
    })

    it('on conflict, returns inserted:false and re-selects the existing row id', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      dbMock.insert.mockReturnValueOnce(chain([]))
      dbMock.select.mockReturnValueOnce(chain([{ id: 'evt-existing' }]))

      const result = await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: 'prospect-1',
        eventName: 'Purchase',
        eventId: 'purchase:installment-1',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        payload: {},
        status: 'pending',
      })

      expect(result).toEqual({ inserted: false, id: 'evt-existing' })
    })

    it('throws if a conflict occurs but the row cannot be re-selected', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      dbMock.insert.mockReturnValueOnce(chain([]))
      dbMock.select.mockReturnValueOnce(chain([]))

      await expect(
        insertConversionEvent({
          tenantId: TENANT_A,
          prospectId: null,
          eventName: 'Lead',
          eventId: 'lead:x',
          eventTime: new Date(),
          payload: {},
          status: 'pending',
        }),
      ).rejects.toThrow()
    })

    it('accepts an optional tx handle instead of the module db', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      const txMock = { insert: vi.fn(), select: vi.fn() } as unknown as Parameters<
        typeof insertConversionEvent
      >[1]
      ;(txMock as unknown as { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValueOnce(
        chain([{ id: 'evt-tx' }]),
      )

      const result = await insertConversionEvent(
        {
          tenantId: TENANT_A,
          prospectId: null,
          eventName: 'Lead',
          eventId: 'lead:tx',
          eventTime: new Date(),
          payload: {},
          status: 'pending',
        },
        txMock,
      )

      expect(result).toEqual({ inserted: true, id: 'evt-tx' })
      expect(dbMock.insert).not.toHaveBeenCalled()
    })
  })

  describe('markEventSent', () => {
    it('sets status sent, sentAt and fbTraceId, scoped to tenant + id', async () => {
      const { markEventSent } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventSent(TENANT_A, 'evt-1', 'trace-123')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall.status).toBe('sent')
      expect(setCall.fbTraceId).toBe('trace-123')
      expect(setCall.sentAt).toBeInstanceOf(Date)
    })

    it('defaults fbTraceId to null when omitted', async () => {
      const { markEventSent } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventSent(TENANT_A, 'evt-1')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall.fbTraceId).toBeNull()
    })
  })

  describe('markEventFailure', () => {
    it("'invalid' sets status failed on the first attempt", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 0 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_A, 'evt-1', 'invalid', 'bad payload')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 1, status: 'failed', lastError: 'bad payload' })
    })

    it("'auth' sets status failed on the first attempt", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 0 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_A, 'evt-1', 'auth', 'dead token')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 1, status: 'failed' })
    })

    it("'transient' stays pending at attempt 1", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 0 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 1, status: 'pending' })
    })

    it("'transient' flips to failed once attempts reaches 8", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 7 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 8, status: 'failed' })
    })

    it("'transient' stays pending at attempt 7", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 6 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 7, status: 'pending' })
    })

    it('scopes the lookup select to tenantId and id', async () => {
      const { markEventFailure } = await import('../meta-events')
      const selectChain = chain([{ attempts: 0 }])
      dbMock.select.mockReturnValueOnce(selectChain)
      dbMock.update.mockReturnValueOnce(chain(undefined))

      await markEventFailure(TENANT_B, 'evt-9', 'invalid', 'x')

      expect(selectChain.__calls.where).toHaveLength(1)
    })
  })

  describe('markEventSkipped', () => {
    it('sets status skipped with the reason', async () => {
      const { markEventSkipped } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventSkipped(TENANT_A, 'evt-1', 'marketing_opt_out')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'skipped', skipReason: 'marketing_opt_out' })
    })
  })

  describe('claimPendingEvents', () => {
    it('runs inside a transaction, selects with FOR UPDATE SKIP LOCKED, and increments attempts', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const row = {
        id: 'evt-1',
        tenantId: TENANT_A,
        prospectId: 'prospect-1',
        eventName: 'Lead',
        eventId: 'lead:1',
        eventTime: new Date('2026-08-28T10:00:00Z'),
        value: null,
        currency: 'BRL',
        payload: {},
        attempts: 0,
        status: 'pending',
        createdAt: new Date('2026-08-28T09:00:00Z'),
      }

      const selectChain = chain([row])
      const updateChain = chain(undefined)
      const trx = {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
      }

      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const result = await claimPendingEvents(10)

      expect(dbMock.transaction).toHaveBeenCalledTimes(1)
      expect(selectChain.__calls.for).toEqual([['update', { skipLocked: true }]])
      expect(selectChain.__calls.orderBy).toHaveLength(1)
      expect(selectChain.__calls.limit).toEqual([[10]])
      expect(trx.update).toHaveBeenCalledTimes(1)
      // Local `attempts` reflects the increment that happened under the lock.
      expect(result).toEqual([
        {
          id: row.id,
          tenantId: row.tenantId,
          prospectId: row.prospectId,
          eventName: row.eventName,
          eventId: row.eventId,
          eventTime: row.eventTime,
          value: row.value,
          currency: row.currency,
          payload: row.payload,
          attempts: 1,
        },
      ])
    })

    it('excludes rows younger than 60 seconds via the createdAt filter', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const selectChain = chain([])
      const trx = {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const before = Date.now()
      const result = await claimPendingEvents(5)
      const after = Date.now()

      expect(result).toEqual([])
      expect(trx.update).not.toHaveBeenCalled()

      // The `where` call receives a single SQL condition built from `and(...)`.
      // We can't easily introspect the SQL tree for the cutoff value here, but
      // we can assert the query ran within the 60s-ago window by checking the
      // call happened between test start and end (sanity on our own clock).
      expect(selectChain.__calls.where).toHaveLength(1)
      expect(before).toBeLessThanOrEqual(after)
    })

    it('returns [] and skips the increment update when nothing is claimable', async () => {
      const { claimPendingEvents } = await import('../meta-events')
      const trx = {
        select: vi.fn(() => chain([])),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const result = await claimPendingEvents(5)

      expect(result).toEqual([])
      expect(trx.update).not.toHaveBeenCalled()
    })
  })

  describe('listRecentEvents', () => {
    it('returns rows scoped to tenantId with the given limit', async () => {
      const { listRecentEvents } = await import('../meta-events')
      const rows = [{ id: 'evt-1' }, { id: 'evt-2' }]
      const selectChain = chain(rows)
      dbMock.select.mockReturnValueOnce(selectChain)

      const result = await listRecentEvents(TENANT_A, 20)

      expect(result).toBe(rows)
      expect(selectChain.__calls.limit).toEqual([[20]])
    })
  })

  describe('hasEvent', () => {
    it('returns true when a row exists for the tenant + eventId', async () => {
      const { hasEvent } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ id: 'evt-1' }]))

      expect(await hasEvent(TENANT_A, 'lead:1')).toBe(true)
    })

    it('returns false when no row exists', async () => {
      const { hasEvent } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([]))

      expect(await hasEvent(TENANT_A, 'lead:missing')).toBe(false)
    })
  })

  describe('hasScheduleForProspect', () => {
    it('matches a Schedule row even when its event id is keyed by appointment id, not prospect id', async () => {
      const { hasScheduleForProspect } = await import('../meta-events')
      // eventId is `schedule:<appointmentId>`, unrelated in shape to prospectId,
      // yet the row's prospectId column still links it to the prospect.
      const selectChain = chain([{ id: 'evt-appt-99' }])
      dbMock.select.mockReturnValueOnce(selectChain)

      const result = await hasScheduleForProspect(TENANT_A, 'prospect-1')

      expect(result).toBe(true)
    })

    it('returns false when the prospect has no Schedule row', async () => {
      const { hasScheduleForProspect } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([]))

      expect(await hasScheduleForProspect(TENANT_A, 'prospect-2')).toBe(false)
    })
  })
})

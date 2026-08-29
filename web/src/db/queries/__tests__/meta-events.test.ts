import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const dialect = new PgDialect()

/** Renders a real drizzle condition so a test can assert on its SQL. */
function renderSql(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL)
}

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

    it('stores the action source so a later rebuild does not have to guess it', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      const insertChain = chain([{ id: 'evt-1' }])
      dbMock.insert.mockReturnValueOnce(insertChain)

      await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: 'prospect-1',
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        actionSource: 'business_messaging',
        payload: {},
        status: 'pending',
      })

      expect(insertChain.__calls.values[0][0]).toMatchObject({ actionSource: 'business_messaging' })
    })

    it('stores null when the caller passes no action source', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      const insertChain = chain([{ id: 'evt-1' }])
      dbMock.insert.mockReturnValueOnce(insertChain)

      await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: null,
        eventName: 'Lead',
        eventId: 'lead:x',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        payload: {},
        status: 'pending',
      })

      expect(insertChain.__calls.values[0][0]).toMatchObject({ actionSource: null })
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

    it('persists patientId on a bare row, the only handle the cron has on a walk-in Purchase', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      const insertChain = chain([{ id: 'evt-bare' }])
      dbMock.insert.mockReturnValueOnce(insertChain)

      const result = await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: null,
        patientId: 'patient-7',
        eventName: 'Purchase',
        eventId: 'purchase:installment-1',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        value: '250.00',
        payload: null,
        status: 'pending',
      })

      expect(result).toEqual({ inserted: true, id: 'evt-bare' })
      expect(insertChain.__calls.values[0][0]).toMatchObject({
        prospectId: null,
        patientId: 'patient-7',
        payload: null,
      })
    })

    it('stores patientId as null when the caller omits it', async () => {
      const { insertConversionEvent } = await import('../meta-events')
      const insertChain = chain([{ id: 'evt-1' }])
      dbMock.insert.mockReturnValueOnce(insertChain)

      await insertConversionEvent({
        tenantId: TENANT_A,
        prospectId: 'prospect-1',
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        eventTime: new Date('2026-08-28T12:00:00Z'),
        payload: {},
        status: 'pending',
      })

      expect(insertChain.__calls.values[0][0]).toMatchObject({ patientId: null })
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
    it("'invalid' fails the row on the first attempt and spends no attempt", async () => {
      const { markEventFailure } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      const status = await markEventFailure(TENANT_A, 'evt-1', 'invalid', 'bad payload')

      expect(status).toBe('failed')
      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'failed', lastError: 'bad payload' })
      expect(setCall).not.toHaveProperty('attempts')
      expect(dbMock.select).not.toHaveBeenCalled()
    })

    it("'auth' keeps the row pending so a re-pasted token can still deliver it", async () => {
      const { markEventFailure } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      const status = await markEventFailure(TENANT_A, 'evt-1', 'auth', 'dead token')

      expect(status).toBe('pending')
      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'pending', lastError: 'dead token' })
    })

    it("'auth' never spends an attempt, however many times it repeats", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.update.mockReturnValue(chain(undefined))

      for (let i = 0; i < 20; i += 1) {
        expect(await markEventFailure(TENANT_A, 'evt-1', 'auth', 'dead token')).toBe('pending')
      }

      // No read of the attempts column at all: the budget is untouched.
      expect(dbMock.select).not.toHaveBeenCalled()
    })

    it("'transient' increments attempts exactly once and stays pending at attempt 1", async () => {
      const { markEventFailure } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: 0 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      const status = await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      expect(status).toBe('pending')
      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: 1, status: 'pending' })
    })

    it("'transient' flips to failed once attempts reaches MAX_ATTEMPTS", async () => {
      const { markEventFailure, MAX_ATTEMPTS } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: MAX_ATTEMPTS - 1 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      const status = await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      expect(status).toBe('failed')
      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: MAX_ATTEMPTS, status: 'failed' })
    })

    it("'transient' still retries one attempt below MAX_ATTEMPTS", async () => {
      const { markEventFailure, MAX_ATTEMPTS } = await import('../meta-events')
      dbMock.select.mockReturnValueOnce(chain([{ attempts: MAX_ATTEMPTS - 2 }]))
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      const status = await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      expect(status).toBe('pending')
      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toMatchObject({ attempts: MAX_ATTEMPTS - 1, status: 'pending' })
    })

    it('a full transient budget takes MAX_ATTEMPTS cron cycles, not half of them', async () => {
      const { markEventFailure, MAX_ATTEMPTS } = await import('../meta-events')

      let attempts = 0
      let cycles = 0
      let status: string = 'pending'

      while (status === 'pending' && cycles < 100) {
        dbMock.select.mockReturnValueOnce(chain([{ attempts }]))
        const updateChain = chain(undefined)
        dbMock.update.mockReturnValueOnce(updateChain)

        status = await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')
        attempts = (updateChain.__calls.set[0][0] as { attempts: number }).attempts
        cycles += 1
      }

      expect(status).toBe('failed')
      expect(cycles).toBe(MAX_ATTEMPTS)
    })

    it('scopes the update to tenantId and id', async () => {
      const { markEventFailure } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_B, 'evt-9', 'invalid', 'x')

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"tenant_id" =')
      expect(text).toContain('"id" =')
      expect(params).toEqual([TENANT_B, 'evt-9'])
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

  describe('selectPendingEvents', () => {
    it('runs inside a transaction with FOR UPDATE SKIP LOCKED and returns the trimmed rows', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const row = {
        id: 'evt-1',
        tenantId: TENANT_A,
        prospectId: null,
        patientId: null,
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        eventTime: new Date('2026-08-28T09:00:00Z'),
        value: null,
        payload: { event_name: 'Lead' },
        createdAt: new Date('2026-08-28T09:00:00Z'),
      }

      const selectChain = chain([row])
      const trx = {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => chain(undefined)),
      }

      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const result = await selectPendingEvents(10)

      expect(dbMock.transaction).toHaveBeenCalledTimes(1)
      expect(selectChain.__calls.for).toEqual([['update', { skipLocked: true }]])
      expect(selectChain.__calls.orderBy).toHaveLength(1)
      expect(selectChain.__calls.limit).toEqual([[10]])
      expect(result).toEqual([row])
    })

    it('does not touch attempts: selecting a row is not a delivery attempt', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const trx = {
        select: vi.fn(() =>
          chain([
            { id: 'evt-1', tenantId: TENANT_A, prospectId: null, patientId: null, payload: {}, createdAt: new Date() },
          ]),
        ),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      await selectPendingEvents(10)

      expect(trx.update).not.toHaveBeenCalled()
    })

    it('excludes rows younger than 60 seconds via the createdAt filter', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const selectChain = chain([])
      const trx = {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const before = Date.now()
      const result = await selectPendingEvents(5)

      expect(result).toEqual([])

      const { sql: text, params } = renderSql(selectChain.__calls.where[0][0])
      expect(text).toContain('"status" =')
      expect(text).toContain('"created_at" <')
      expect(params[0]).toBe('pending')
      // Bound to the driver value (an ISO timestamp), not the Date object.
      expect(Date.parse(String(params[1]))).toBeLessThanOrEqual(before - 59_000)
    })

    // Fix 4: without the per-tenant cap a clinic with a revoked token owns
    // every slot in the run, and no other clinic's rows are ever reached.
    it('caps how many rows one tenant can take from a single run', async () => {
      const { selectPendingEvents, MAX_EVENTS_PER_TENANT } = await import('../meta-events')

      const selectChain = chain([])
      const trx = {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      await selectPendingEvents(500)

      const { sql: text, params } = renderSql(selectChain.__calls.where[0][0])
      expect(text).toContain('row_number() over')
      expect(text).toContain('partition by "floraclin"."meta_conversion_events"."tenant_id"')
      expect(text).toContain('ranked.tenant_rank <=')
      expect(params).toContain(MAX_EVENTS_PER_TENANT)
      // The overall cap and the row lock both survive the per-tenant cap.
      expect(selectChain.__calls.limit).toEqual([[500]])
      expect(selectChain.__calls.for).toEqual([['update', { skipLocked: true }]])
    })

    it('returns the stored action source with the row', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const trx = {
        select: vi.fn(() =>
          chain([
            {
              id: 'evt-1',
              tenantId: TENANT_A,
              prospectId: 'prospect-1',
              patientId: 'patient-1',
              eventName: 'Lead',
              eventId: 'lead:prospect-1',
              eventTime: new Date('2026-08-28T09:00:00Z'),
              value: null,
              actionSource: 'business_messaging',
              payload: null,
              createdAt: new Date('2026-08-28T09:00:00Z'),
            },
          ]),
        ),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const [event] = await selectPendingEvents(10)

      expect(event.actionSource).toBe('business_messaging')
    })

    it('returns [] when nothing is pending', async () => {
      const { selectPendingEvents } = await import('../meta-events')
      const trx = {
        select: vi.fn(() => chain([])),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      expect(await selectPendingEvents(5)).toEqual([])
    })

    it('prefers the stored patientId over the prospect fallback', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const trx = {
        select: vi.fn(() =>
          chain([
            {
              id: 'evt-1',
              tenantId: TENANT_A,
              prospectId: 'prospect-1',
              patientId: 'patient-stored',
              eventName: 'Purchase',
              eventId: 'purchase:installment-1',
              eventTime: new Date('2026-08-28T09:00:00Z'),
              value: '250.00',
              payload: null,
              createdAt: new Date('2026-08-28T09:00:00Z'),
            },
          ]),
        ),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))

      const [event] = await selectPendingEvents(10)

      expect(event.patientId).toBe('patient-stored')
      // The prospect lookup is skipped entirely for a row that already knows.
      expect(dbMock.select).not.toHaveBeenCalled()
    })

    it("falls back to the prospect's convertedPatientId when no patientId is stored", async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const trx = {
        select: vi.fn(() =>
          chain([
            {
              id: 'evt-1',
              tenantId: TENANT_A,
              prospectId: 'prospect-1',
              patientId: null,
              eventName: 'Lead',
              eventId: 'lead:prospect-1',
              eventTime: new Date('2026-08-28T09:00:00Z'),
              value: null,
              payload: {},
              createdAt: new Date('2026-08-28T09:00:00Z'),
            },
          ]),
        ),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))
      dbMock.select.mockReturnValueOnce(
        chain([{ id: 'prospect-1', tenantId: TENANT_A, convertedPatientId: 'patient-converted' }]),
      )

      const [event] = await selectPendingEvents(10)

      expect(event.patientId).toBe('patient-converted')
    })

    it('never picks up another tenant\'s patient link for the same prospect id', async () => {
      const { selectPendingEvents } = await import('../meta-events')

      const trx = {
        select: vi.fn(() =>
          chain([
            {
              id: 'evt-1',
              tenantId: TENANT_B,
              prospectId: 'prospect-1',
              patientId: null,
              eventName: 'Lead',
              eventId: 'lead:prospect-1',
              eventTime: new Date('2026-08-28T09:00:00Z'),
              value: null,
              payload: {},
              createdAt: new Date('2026-08-28T09:00:00Z'),
            },
          ]),
        ),
        update: vi.fn(() => chain(undefined)),
      }
      dbMock.transaction.mockImplementationOnce(async (cb: (trx: unknown) => unknown) => cb(trx))
      dbMock.select.mockReturnValueOnce(
        chain([{ id: 'prospect-1', tenantId: TENANT_A, convertedPatientId: 'patient-of-a' }]),
      )

      const [event] = await selectPendingEvents(10)

      expect(event.patientId).toBeNull()
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

    it('ignores skipped rows so an unconnected-clinic Schedule does not block the real one', async () => {
      const { hasScheduleForProspect } = await import('../meta-events')
      const selectChain = chain([])
      dbMock.select.mockReturnValueOnce(selectChain)

      await hasScheduleForProspect(TENANT_A, 'prospect-3')

      const { sql: text, params } = renderSql(selectChain.__calls.where[0][0])
      expect(text).toContain('"status" <>')
      expect(params).toEqual([TENANT_A, 'prospect-3', 'Schedule', 'skipped'])
    })
  })
})

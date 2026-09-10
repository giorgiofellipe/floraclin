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

    // Fix 1: a slow sender whose claim was reaped must not overwrite the
    // outcome the row's new owner already recorded.
    it('only writes a row this sender still owns', async () => {
      const { markEventSent } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventSent(TENANT_A, 'evt-1')

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"status" =')
      expect(params).toEqual([TENANT_A, 'evt-1', 'sending'])
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
      expect(setCall).toEqual({ status: 'failed', lastError: 'bad payload', claimedAt: null })
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
      expect(setCall).toEqual({ status: 'pending', lastError: 'dead token', claimedAt: null })
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

    it('scopes the update to tenantId, id and an unfinished claim', async () => {
      const { markEventFailure } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventFailure(TENANT_B, 'evt-9', 'invalid', 'x')

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"tenant_id" =')
      expect(text).toContain('"id" =')
      expect(text).toContain('"status" =')
      expect(params).toEqual([TENANT_B, 'evt-9', 'sending'])
    })

    // Fix 1: the row was already marked `sent` by the sender that beat this
    // one, so the transient path must not flip it back to `pending`.
    it("a late transient write cannot reopen a row the winner already closed", async () => {
      const { markEventFailure } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)
      dbMock.select.mockReturnValueOnce(chain([]))

      await markEventFailure(TENANT_A, 'evt-1', 'transient', 'timeout')

      for (const call of dbMock.update.mock.results) {
        const built = (call.value as ReturnType<typeof chain>).__calls
        const { params } = renderSql(built.where[0][0])
        expect(params).toContain('sending')
      }
    })
  })

  describe('markEventSkipped', () => {
    it('sets status skipped with the reason', async () => {
      const { markEventSkipped } = await import('../meta-events')
      const updateChain = chain(undefined)
      dbMock.update.mockReturnValueOnce(updateChain)

      await markEventSkipped(TENANT_A, 'evt-1', 'marketing_opt_out')

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'skipped', skipReason: 'marketing_opt_out', claimedAt: null })

      const { params } = renderSql(updateChain.__calls.where[0][0])
      expect(params).toEqual([TENANT_A, 'evt-1', 'sending'])
    })
  })

  describe('claimPendingEvents', () => {
    it('claims with a single UPDATE ... RETURNING instead of a lock that dies with its transaction', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const row = {
        id: 'evt-1',
        tenantId: TENANT_A,
        prospectId: null,
        patientId: null,
        eventName: 'Lead',
        eventId: 'lead:prospect-1',
        eventTime: new Date('2026-08-28T09:00:00Z'),
        value: null,
        actionSource: null,
        payload: { event_name: 'Lead' },
        createdAt: new Date('2026-08-28T09:00:00Z'),
      }
      const updateChain = chain([row])
      dbMock.update.mockReturnValueOnce(updateChain)

      const result = await claimPendingEvents(10)

      expect(result).toEqual([row])
      expect(dbMock.transaction).not.toHaveBeenCalled()
      expect(updateChain.__calls.returning).toHaveLength(1)

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall.status).toBe('sending')
      expect(setCall.claimedAt).toBeInstanceOf(Date)
    })

    // Fix 1: the claim is what stops two runs picking the same row.
    it('does not return a row a second caller already claimed', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const first = chain([
        {
          id: 'evt-1',
          tenantId: TENANT_A,
          prospectId: null,
          patientId: null,
          eventName: 'Lead',
          eventId: 'lead:prospect-1',
          eventTime: new Date('2026-08-28T09:00:00Z'),
          value: null,
          actionSource: null,
          payload: {},
          createdAt: new Date('2026-08-28T09:00:00Z'),
        },
      ])
      // The second run's UPDATE matches nothing: the row is no longer pending.
      const second = chain([])
      dbMock.update.mockReturnValueOnce(first).mockReturnValueOnce(second)

      expect(await claimPendingEvents(10)).toHaveLength(1)
      expect(await claimPendingEvents(10)).toEqual([])

      // `status = 'pending'` is on the UPDATE itself, not only in the
      // subquery, so a concurrent claim is re-checked against the row.
      const { sql: text, params } = renderSql(second.__calls.where[0][0])
      expect(text).toContain('"status" =')
      expect(params[0]).toBe('pending')
    })

    it('excludes rows younger than 60 seconds via the createdAt filter', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const updateChain = chain([])
      dbMock.update.mockReturnValueOnce(updateChain)

      const before = Date.now()
      expect(await claimPendingEvents(5)).toEqual([])

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"created_at" <')
      // Bound to the driver value (an ISO timestamp), not the Date object.
      const cutoff = params.find((value) => Date.parse(String(value)))
      expect(Date.parse(String(cutoff))).toBeLessThanOrEqual(before - 59_000)
    })

    it('caps how many rows one tenant can take from a single run', async () => {
      const { claimPendingEvents, MAX_EVENTS_PER_TENANT } = await import('../meta-events')

      const updateChain = chain([])
      dbMock.update.mockReturnValueOnce(updateChain)

      await claimPendingEvents(500)

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('row_number() over')
      expect(text).toContain('partition by "floraclin"."meta_conversion_events"."tenant_id"')
      expect(text).toContain('ranked.tenant_rank <=')
      expect(text).toContain('order by ranked.created_at')
      expect(params).toContain(MAX_EVENTS_PER_TENANT)
      expect(params).toContain(500)
    })

    // Fix 6: a bare 50 against a daily cron drained 350 rows a week, and Meta
    // rejects whatever is left when the window closes.
    it('sizes the per-tenant cap off the window Meta accepts, not a bare literal', async () => {
      const { MAX_EVENTS_PER_TENANT, META_EVENT_WINDOW_DAYS } = await import('../meta-events')

      expect(META_EVENT_WINDOW_DAYS).toBe(7)
      expect(MAX_EVENTS_PER_TENANT % META_EVENT_WINDOW_DAYS).toBe(0)
      expect(MAX_EVENTS_PER_TENANT).toBeGreaterThan(500)
    })

    it('returns claimed rows oldest first, whatever order the UPDATE returned them in', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      const base = {
        tenantId: TENANT_A,
        prospectId: null,
        patientId: 'patient-1',
        eventName: 'Lead',
        eventId: 'lead:x',
        eventTime: new Date('2026-08-28T09:00:00Z'),
        value: null,
        actionSource: null,
        payload: {},
      }
      dbMock.update.mockReturnValueOnce(
        chain([
          { ...base, id: 'newer', createdAt: new Date('2026-08-28T10:00:00Z') },
          { ...base, id: 'older', createdAt: new Date('2026-08-28T08:00:00Z') },
        ]),
      )

      const result = await claimPendingEvents(10)

      expect(result.map((row) => row.id)).toEqual(['older', 'newer'])
    })

    it('returns the stored action source with the row', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      dbMock.update.mockReturnValueOnce(
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
      )

      const [event] = await claimPendingEvents(10)

      expect(event.actionSource).toBe('business_messaging')
    })

    it('returns [] when nothing is pending', async () => {
      const { claimPendingEvents } = await import('../meta-events')
      dbMock.update.mockReturnValueOnce(chain([]))

      expect(await claimPendingEvents(5)).toEqual([])
    })

    it('prefers the stored patientId over the prospect fallback', async () => {
      const { claimPendingEvents } = await import('../meta-events')

      dbMock.update.mockReturnValueOnce(
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
            actionSource: null,
            payload: null,
            createdAt: new Date('2026-08-28T09:00:00Z'),
          },
        ]),
      )

      const [event] = await claimPendingEvents(10)

      expect(event.patientId).toBe('patient-stored')
      // The prospect lookup is skipped entirely for a row that already knows.
      expect(dbMock.select).not.toHaveBeenCalled()
    })

    it("falls back to the prospect's convertedPatientId when no patientId is stored", async () => {
      const { claimPendingEvents } = await import('../meta-events')

      dbMock.update.mockReturnValueOnce(
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
            actionSource: null,
            payload: {},
            createdAt: new Date('2026-08-28T09:00:00Z'),
          },
        ]),
      )
      dbMock.select.mockReturnValueOnce(
        chain([{ id: 'prospect-1', tenantId: TENANT_A, convertedPatientId: 'patient-converted' }]),
      )

      const [event] = await claimPendingEvents(10)

      expect(event.patientId).toBe('patient-converted')
    })

    it("never picks up another tenant's patient link for the same prospect id", async () => {
      const { claimPendingEvents } = await import('../meta-events')

      dbMock.update.mockReturnValueOnce(
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
            actionSource: null,
            payload: {},
            createdAt: new Date('2026-08-28T09:00:00Z'),
          },
        ]),
      )
      dbMock.select.mockReturnValueOnce(
        chain([{ id: 'prospect-1', tenantId: TENANT_A, convertedPatientId: 'patient-of-a' }]),
      )

      const [event] = await claimPendingEvents(10)

      expect(event.patientId).toBeNull()
    })
  })

  describe('claimEventForSending', () => {
    it('claims a pending row and reports it took it', async () => {
      const { claimEventForSending } = await import('../meta-events')
      const updateChain = chain([{ id: 'evt-1' }])
      dbMock.update.mockReturnValueOnce(updateChain)

      expect(await claimEventForSending(TENANT_A, 'evt-1')).toBe(true)

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall.status).toBe('sending')

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"status" =')
      expect(params).toEqual([TENANT_A, 'evt-1', 'pending'])
    })

    it('reports false when the row is no longer pending, so the caller does not send', async () => {
      const { claimEventForSending } = await import('../meta-events')
      dbMock.update.mockReturnValueOnce(chain([]))

      expect(await claimEventForSending(TENANT_A, 'evt-1')).toBe(false)
    })
  })

  describe('releaseEventClaims', () => {
    it('returns claimed rows to pending and clears the claim timestamp', async () => {
      const { releaseEventClaims } = await import('../meta-events')
      const updateChain = chain([])
      dbMock.update.mockReturnValueOnce(updateChain)

      await releaseEventClaims(['evt-1', 'evt-2'])

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'pending', claimedAt: null })

      const { params } = renderSql(updateChain.__calls.where[0][0])
      expect(params).toEqual(['sending', 'evt-1', 'evt-2'])
    })

    it('writes nothing when there is nothing to release', async () => {
      const { releaseEventClaims } = await import('../meta-events')

      await releaseEventClaims([])

      expect(dbMock.update).not.toHaveBeenCalled()
    })
  })

  describe('reapStuckClaims', () => {
    // Fix 1: a crash between the claim and the outcome would otherwise park
    // the row in `sending` forever.
    it('returns a row stuck in sending past the timeout to pending', async () => {
      const { reapStuckClaims, SENDING_CLAIM_TIMEOUT_MS } = await import('../meta-events')
      const updateChain = chain([{ id: 'evt-stuck' }])
      dbMock.update.mockReturnValueOnce(updateChain)

      const now = new Date('2026-08-28T12:00:00Z')
      expect(await reapStuckClaims(now)).toBe(1)

      const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
      expect(setCall).toEqual({ status: 'pending', claimedAt: null })

      const { sql: text, params } = renderSql(updateChain.__calls.where[0][0])
      expect(text).toContain('"status" =')
      expect(text).toContain('"claimed_at" <')
      expect(params[0]).toBe('sending')
      expect(Date.parse(String(params[1]))).toBe(now.getTime() - SENDING_CLAIM_TIMEOUT_MS)
    })

    it('leaves a claim that is still inside the timeout alone', async () => {
      const { reapStuckClaims } = await import('../meta-events')
      dbMock.update.mockReturnValueOnce(chain([]))

      expect(await reapStuckClaims(new Date('2026-08-28T12:00:00Z'))).toBe(0)
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

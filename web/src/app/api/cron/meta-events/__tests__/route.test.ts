/**
 * Unit tests for the meta-events cron job: the retry sweep (job 1), the
 * reconciliation sweep (job 2) that repairs a crash between a domain write
 * and its outbox insert, and the ad metadata backfill (job 3).
 *
 * All DB queries, the shared sender and enqueueMetaEvent are mocked -- no
 * network or database access occurs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const dialect = new PgDialect()

/** Renders a real drizzle condition so a test can assert on its SQL. */
function renderSql(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL)
}

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────
//
// `vi.mock` factories run before any top-level `const` in this file (ES
// import statements, including the static `import ... from '../route'`
// below, are themselves hoisted above plain declarations), so anything a
// factory closes over must go through `vi.hoisted` or it's a TDZ error.

const { dbMock, captureMessageMock, captureExceptionMock, withMonitorMock, flushMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn() },
  captureMessageMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  withMonitorMock: vi.fn((_slug: string, fn: () => unknown) => fn()),
  flushMock: vi.fn(async (_timeout?: number) => true),
}))

// The route runs under withCronMonitor, which is left real so the closing
// flush is exercised. Standing in for withMonitor runs the body; flush stays
// observable because a cron that never flushes reports phantom timeouts.
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  withMonitor: (...args: unknown[]) => withMonitorMock(...(args as [string, () => unknown])),
  flush: (timeout?: number) => flushMock(timeout),
}))

vi.mock('@/db/client', () => ({ db: dbMock }))

// A chainable, awaitable stand-in for drizzle's query builders, matching the
// pattern in `web/src/db/queries/__tests__/meta-events.test.ts`.
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
        if (prop === '__calls') return calls
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

vi.mock('@/db/queries/meta-events', () => ({
  selectPendingEvents: vi.fn(),
  countEventOutcomes: vi.fn(),
  markEventSkipped: vi.fn(),
  hasScheduleForProspect: vi.fn(),
}))

vi.mock('@/db/queries/meta-connections', () => ({
  getMetaConnection: vi.fn(),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(),
  sendPendingEvent: vi.fn(),
}))

vi.mock('@/lib/meta/ad-metadata', () => ({
  backfillAdMetadata: vi.fn(),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import {
  countEventOutcomes,
  hasScheduleForProspect,
  markEventSkipped,
  selectPendingEvents,
  type PendingEvent,
} from '@/db/queries/meta-events'
import { getMetaConnection, type MetaConnection } from '@/db/queries/meta-connections'
import { enqueueMetaEvent, sendPendingEvent } from '@/lib/meta/events'
import { backfillAdMetadata } from '@/lib/meta/ad-metadata'
import { GET, MONITOR_SCHEDULE, computeReconciliationWindowStart } from '../route'

// ─── Helpers ─────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret'
const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers['authorization'] = `Bearer ${token}`
  return new Request('http://localhost/api/cron/meta-events', { method: 'GET', headers })
}

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000

function makePendingEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
  return {
    id: 'evt-1',
    tenantId: TENANT_A,
    prospectId: 'prospect-1',
    patientId: null,
    eventName: 'Lead',
    eventId: 'lead:prospect-1',
    eventTime: new Date(),
    value: null,
    payload: { event_name: 'Lead', event_id: 'lead:prospect-1' },
    createdAt: new Date(),
    ...overrides,
  }
}

function makeConnection(overrides: Record<string, unknown> = {}): MetaConnection {
  return {
    tenantId: TENANT_A,
    datasetId: 'dataset-1',
    accessToken: 'tok',
    testEventCode: null,
    advancedMatchingEnabled: true,
    connectionType: 'oauth',
    status: 'active',
    ...overrides,
  } as unknown as MetaConnection
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.META_EVENTS_START_AT
  dbMock.select.mockReset().mockReturnValue(chain([]))
  vi.mocked(selectPendingEvents).mockResolvedValue([])
  vi.mocked(countEventOutcomes).mockResolvedValue({ sent: 0, failed: 0 })
  vi.mocked(hasScheduleForProspect).mockResolvedValue(false)
  vi.mocked(sendPendingEvent).mockResolvedValue(undefined)
  vi.mocked(backfillAdMetadata).mockResolvedValue({ resolved: 0 })
})

// ─── Tests ───────────────────────────────────────────────────────────

describe('GET /api/cron/meta-events', () => {
  describe('authentication', () => {
    it('returns 401 without the bearer token', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      expect(selectPendingEvents).not.toHaveBeenCalled()
    })

    it('returns 401 when the bearer token does not match CRON_SECRET', async () => {
      const res = await GET(makeRequest('wrong'))
      expect(res.status).toBe(401)
    })
  })

  describe('retry sweep', () => {
    it('hands each pending row to the shared sender and reports the outcome', async () => {
      const event = makePendingEvent()
      vi.mocked(selectPendingEvents).mockResolvedValue([event])
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection())
      vi.mocked(countEventOutcomes).mockResolvedValue({ sent: 1, failed: 0 })

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(sendPendingEvent).toHaveBeenCalledWith(event)
      expect(countEventOutcomes).toHaveBeenCalledWith(TENANT_A, [event.id])
      expect(json.retrySweep).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    })

    it('groups rows by tenant and reads each tenant connection separately', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([
        makePendingEvent({ id: 'evt-a' }),
        makePendingEvent({ id: 'evt-b', tenantId: TENANT_B }),
      ])
      vi.mocked(getMetaConnection).mockImplementation(async (tenantId: string) =>
        makeConnection({ tenantId }),
      )

      await GET(makeRequest(CRON_SECRET))

      expect(countEventOutcomes).toHaveBeenCalledWith(TENANT_A, ['evt-a'])
      expect(countEventOutcomes).toHaveBeenCalledWith(TENANT_B, ['evt-b'])
    })

    it("leaves a no-connection tenant's rows pending: the connection can come back", async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([
        makePendingEvent({ id: 'evt-1' }),
        makePendingEvent({ id: 'evt-2' }),
      ])
      vi.mocked(getMetaConnection).mockResolvedValue(null)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(sendPendingEvent).not.toHaveBeenCalled()
      expect(markEventSkipped).not.toHaveBeenCalled()
      expect(json.retrySweep.deferredNoConnection).toBe(2)
      expect(json.retrySweep.skippedNoConnection).toBe(0)
    })

    it('leaves rows pending while the token is invalid instead of posting them again', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([makePendingEvent({ id: 'evt-1' })])
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection({ status: 'invalid_token' }))

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(sendPendingEvent).not.toHaveBeenCalled()
      expect(markEventSkipped).not.toHaveBeenCalled()
      expect(json.retrySweep.deferredNoConnection).toBe(1)
    })

    it('gives up on a row only once it is older than Meta accepts', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([
        makePendingEvent({ id: 'evt-old', createdAt: new Date(Date.now() - EIGHT_DAYS_MS) }),
        makePendingEvent({ id: 'evt-new' }),
      ])
      vi.mocked(getMetaConnection).mockResolvedValue(null)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(markEventSkipped).toHaveBeenCalledTimes(1)
      expect(markEventSkipped).toHaveBeenCalledWith(TENANT_A, 'evt-old', 'no_connection')
      expect(json.retrySweep.skippedNoConnection).toBe(1)
      expect(json.retrySweep.deferredNoConnection).toBe(1)
    })

    it("stops a tenant's batch as soon as the sender flags the token dead", async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([
        makePendingEvent({ id: 'evt-1' }),
        makePendingEvent({ id: 'evt-2' }),
        makePendingEvent({ id: 'evt-3' }),
      ])
      vi.mocked(getMetaConnection)
        .mockResolvedValueOnce(makeConnection())
        .mockResolvedValue(makeConnection({ status: 'invalid_token' }))

      await GET(makeRequest(CRON_SECRET))

      expect(sendPendingEvent).toHaveBeenCalledTimes(1)
      expect(countEventOutcomes).toHaveBeenCalledWith(TENANT_A, ['evt-1'])
    })

    it('counts a row as failed only when the stored status says so', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue([
        makePendingEvent({ id: 'evt-1' }),
        makePendingEvent({ id: 'evt-2' }),
      ])
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection())
      vi.mocked(countEventOutcomes).mockResolvedValue({ sent: 1, failed: 1 })

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.retrySweep.failed).toBe(1)
      expect(json.retrySweep.sent).toBe(1)
      expect(captureMessageMock).not.toHaveBeenCalled()
    })

    it('emits a Sentry warning when a tenant has more than 10 rows fail in one run', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue(
        Array.from({ length: 11 }, (_, i) => makePendingEvent({ id: `evt-${i}` })),
      )
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection())
      vi.mocked(countEventOutcomes).mockResolvedValue({ sent: 0, failed: 11 })

      await GET(makeRequest(CRON_SECRET))

      expect(captureMessageMock).toHaveBeenCalledTimes(1)
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ level: 'warning', tags: { tenantId: TENANT_A } }),
      )
    })

    it('does not emit a Sentry warning at or below the 10-row threshold', async () => {
      vi.mocked(selectPendingEvents).mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makePendingEvent({ id: `evt-${i}` })),
      )
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection())
      vi.mocked(countEventOutcomes).mockResolvedValue({ sent: 0, failed: 10 })

      await GET(makeRequest(CRON_SECRET))

      expect(captureMessageMock).not.toHaveBeenCalled()
    })
  })

  describe('reconciliation', () => {
    it('is skipped entirely when META_EVENTS_START_AT is unset', async () => {
      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.reconciliation.skipped).toBe(true)
      expect(enqueueMetaEvent).not.toHaveBeenCalled()
    })

    it('enqueues a missing Contact from a stage_changed activity and not one that already has a row', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'
      const activityCreatedAt = new Date('2026-08-25T15:00:00Z')

      // Query order in the route: leads, then contacts, then schedules.
      dbMock.select
        .mockReturnValueOnce(chain([])) // leads: none missing
        .mockReturnValueOnce(
          chain([
            {
              tenantId: TENANT_A,
              prospectId: 'prospect-2',
              createdAt: activityCreatedAt,
              phone: '5511999990000',
              name: 'Ana Souza',
              convertedPatientId: null,
            },
          ]),
        ) // contacts: one missing (the join already excluded the one with a row)
        .mockReturnValueOnce(chain([])) // schedules: none missing

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
      expect(enqueueMetaEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_A,
          eventName: 'Contact',
          eventId: 'contact:prospect-2',
          prospectId: 'prospect-2',
          contact: { phone: '5511999990000', fullName: 'Ana Souza' },
        }),
      )
      expect(json.reconciliation.reconciled).toBe(1)
    })

    it("passes the prospect's converted patient so the opt-out check sees the patient flag", async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'

      dbMock.select
        .mockReturnValueOnce(
          chain([
            {
              tenantId: TENANT_A,
              prospectId: 'prospect-6',
              createdAt: new Date('2026-08-25T15:00:00Z'),
              phone: '5511999994444',
              name: 'Ja Convertido',
              convertedPatientId: 'patient-6',
            },
          ]),
        ) // leads
        .mockReturnValueOnce(chain([])) // contacts
        .mockReturnValueOnce(chain([])) // schedules

      await GET(makeRequest(CRON_SECRET))

      expect(enqueueMetaEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'Lead', patientId: 'patient-6' }),
      )
    })

    it('uses the activity createdAt as eventTime, not now()', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'
      const activityCreatedAt = new Date('2026-08-20T09:30:00Z')

      dbMock.select
        .mockReturnValueOnce(
          chain([
            {
              tenantId: TENANT_A,
              prospectId: 'prospect-3',
              createdAt: activityCreatedAt,
              phone: '5511999991111',
              name: 'Lead Novo',
              convertedPatientId: null,
            },
          ]),
        ) // leads
        .mockReturnValueOnce(chain([])) // contacts
        .mockReturnValueOnce(chain([])) // schedules

      await GET(makeRequest(CRON_SECRET))

      expect(enqueueMetaEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'Lead', eventTime: activityCreatedAt }),
      )
    })

    it('a lead that went straight novo -> agendado gets a Schedule and no Contact', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'
      const activityCreatedAt = new Date('2026-08-22T11:00:00Z')

      dbMock.select
        .mockReturnValueOnce(chain([])) // leads: already has one
        .mockReturnValueOnce(chain([])) // contacts: never went through 'contatado'
        .mockReturnValueOnce(
          chain([
            {
              tenantId: TENANT_A,
              prospectId: 'prospect-4',
              createdAt: activityCreatedAt,
              phone: '5511999992222',
              name: 'Pulou Etapa',
              convertedPatientId: null,
            },
          ]),
        ) // schedules: missing

      vi.mocked(hasScheduleForProspect).mockResolvedValue(false)

      await GET(makeRequest(CRON_SECRET))

      expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
      expect(enqueueMetaEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'Schedule', eventId: 'schedule:prospect-4' }),
      )
      expect(enqueueMetaEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'Contact' }),
      )
    })

    it('does not enqueue a Schedule when the prospect already has one under a different event id', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'

      dbMock.select
        .mockReturnValueOnce(chain([])) // leads
        .mockReturnValueOnce(chain([])) // contacts
        .mockReturnValueOnce(
          chain([
            {
              tenantId: TENANT_A,
              prospectId: 'prospect-5',
              createdAt: new Date('2026-08-22T11:00:00Z'),
              phone: '5511999993333',
              name: 'Ja Agendado',
              convertedPatientId: null,
            },
          ]),
        )

      vi.mocked(hasScheduleForProspect).mockResolvedValue(true)

      await GET(makeRequest(CRON_SECRET))

      expect(enqueueMetaEvent).not.toHaveBeenCalled()
    })

    it("starts each tenant's window at its own connection date, not just the global env floor", async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'
      const leadsChain = chain([])
      dbMock.select.mockReturnValueOnce(leadsChain).mockReturnValue(chain([]))

      await GET(makeRequest(CRON_SECRET))

      const joined = leadsChain.__calls.innerJoin.map((call) => call[0])
      expect(joined).toHaveLength(2)

      const { sql: text } = renderSql(leadsChain.__calls.where[0][0])
      // A clinic that connected today must not backfill leads that predate it.
      expect(text).toContain('"meta_connections"."created_at"')
    })

    it('caps every finder with a LIMIT so one run cannot outlast the function', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'
      const chains = [chain([]), chain([]), chain([])]
      dbMock.select
        .mockReturnValueOnce(chains[0])
        .mockReturnValueOnce(chains[1])
        .mockReturnValueOnce(chains[2])

      await GET(makeRequest(CRON_SECRET))

      for (const c of chains) {
        expect(c.__calls.limit).toHaveLength(1)
        expect(c.__calls.limit[0][0]).toBeGreaterThan(0)
      }
    })

    it('enqueues in parallel batches instead of one round trip at a time', async () => {
      process.env.META_EVENTS_START_AT = '2026-01-01T00:00:00Z'

      const rows = Array.from({ length: 25 }, (_, i) => ({
        tenantId: TENANT_A,
        prospectId: `prospect-${i}`,
        createdAt: new Date('2026-08-25T15:00:00Z'),
        phone: '5511999990000',
        name: null,
        convertedPatientId: null,
      }))
      dbMock.select
        .mockReturnValueOnce(chain(rows))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]))

      let inFlight = 0
      let peak = 0
      vi.mocked(enqueueMetaEvent).mockImplementation(async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight -= 1
      })

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.reconciliation.reconciled).toBe(25)
      expect(peak).toBeGreaterThan(1)
    })
  })

  describe('ad metadata backfill', () => {
    it('runs for every active oauth connection, not only the tenants the retry sweep touched', async () => {
      const connections = [
        makeConnection({ tenantId: TENANT_A }),
        makeConnection({ tenantId: TENANT_B }),
      ]
      dbMock.select.mockReturnValueOnce(chain(connections))
      vi.mocked(backfillAdMetadata).mockResolvedValue({ resolved: 3 })

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(backfillAdMetadata).toHaveBeenCalledTimes(2)
      expect(backfillAdMetadata).toHaveBeenCalledWith(TENANT_A, connections[0])
      expect(backfillAdMetadata).toHaveBeenCalledWith(TENANT_B, connections[1])
      expect(json.adMetadataBackfill.resolved).toBe(6)
    })

    it('scans only oauth connections that are still active', async () => {
      const connectionsChain = chain([])
      dbMock.select.mockReturnValueOnce(connectionsChain)

      await GET(makeRequest(CRON_SECRET))

      const { sql: text, params } = renderSql(connectionsChain.__calls.where[0][0])
      expect(text).toContain('"connection_type" =')
      expect(text).toContain('"status" =')
      expect(params).toEqual(['oauth', 'active'])
    })
  })

  describe('computeReconciliationWindowStart', () => {
    it('ignores activities older than META_EVENTS_START_AT by using it as the window start', () => {
      const now = new Date('2026-08-28T12:00:00Z')
      const startAt = '2026-08-27T00:00:00Z' // 1 day ago, newer than 7 days ago

      const windowStart = computeReconciliationWindowStart(startAt, now)

      expect(windowStart?.toISOString()).toBe('2026-08-27T00:00:00.000Z')
    })

    it('falls back to 7 days ago when META_EVENTS_START_AT predates it', () => {
      const now = new Date('2026-08-28T12:00:00Z')
      const startAt = '2020-01-01T00:00:00Z' // long before the 7-day floor

      const windowStart = computeReconciliationWindowStart(startAt, now)

      expect(windowStart?.toISOString()).toBe('2026-08-21T12:00:00.000Z')
    })

    it('returns null for a value with no offset, which would resolve against the host clock', () => {
      const now = new Date('2026-08-28T12:00:00Z')

      expect(computeReconciliationWindowStart('2026-08-27', now)).toBeNull()
      expect(computeReconciliationWindowStart('2026-08-27T00:00:00', now)).toBeNull()
    })
  })

  // Sentry reports every run as late when the monitor and the real schedule
  // disagree, and the Hobby plan rejects anything finer than daily.
  describe('monitor schedule', () => {
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../../../../vercel.json'), 'utf8'),
    ) as { crons: Array<{ path: string; schedule: string }> }

    it('matches the schedule vercel.json declares for this cron', () => {
      const cron = vercelConfig.crons.find((c) => c.path === '/api/cron/meta-events')

      expect(cron).toBeDefined()
      expect(MONITOR_SCHEDULE).toBe(cron?.schedule)
    })

    it('runs at most once a day, and not at the same hour as another cron', () => {
      expect(MONITOR_SCHEDULE).toMatch(/^\d+ \d+ \* \* \*$/)

      const hours = vercelConfig.crons.map((c) => c.schedule)
      expect(new Set(hours).size).toBe(hours.length)
    })
  })
})

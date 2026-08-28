/**
 * Unit tests for the meta-events cron job: the retry sweep (job 1) and the
 * reconciliation sweep (job 2) that repairs a crash between a domain write
 * and its outbox insert.
 *
 * All DB queries, the Conversions API client and enqueueMetaEvent are
 * mocked -- no network or database access occurs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────
//
// `vi.mock` factories run before any top-level `const` in this file (ES
// import statements, including the static `import ... from '../route'`
// below, are themselves hoisted above plain declarations), so anything a
// factory closes over must go through `vi.hoisted` or it's a TDZ error.

const { dbMock, captureMessageMock, withMonitorMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn() },
  captureMessageMock: vi.fn(),
  withMonitorMock: vi.fn((_slug: string, fn: () => unknown) => fn()),
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  withMonitor: (...args: unknown[]) => withMonitorMock(...(args as [string, () => unknown])),
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
  claimPendingEvents: vi.fn(),
  markEventSent: vi.fn(),
  markEventFailure: vi.fn(),
  markEventSkipped: vi.fn(),
  hasScheduleForProspect: vi.fn(),
}))

vi.mock('@/db/queries/meta-connections', () => ({
  getMetaConnection: vi.fn(),
  markConnectionInvalid: vi.fn(),
}))

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: vi.fn(),
}))

vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import {
  claimPendingEvents,
  markEventSent,
  markEventFailure,
  markEventSkipped,
  hasScheduleForProspect,
} from '@/db/queries/meta-events'
import { getMetaConnection, markConnectionInvalid } from '@/db/queries/meta-connections'
import { postEvents } from '@/lib/meta/capi-client'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { GET, computeReconciliationWindowStart } from '../route'

// ─── Helpers ─────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret'
const TENANT_A = 'tenant-a'

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers['authorization'] = `Bearer ${token}`
  return new Request('http://localhost/api/cron/meta-events', { method: 'GET', headers })
}

function makePendingEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    tenantId: TENANT_A,
    prospectId: 'prospect-1',
    eventName: 'Lead',
    eventId: 'lead:prospect-1',
    eventTime: new Date('2026-08-20T12:00:00Z'),
    value: null,
    currency: 'BRL',
    payload: { event_name: 'Lead', event_id: 'lead:prospect-1' },
    attempts: 1,
    ...overrides,
  }
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    datasetId: 'dataset-1',
    accessToken: 'tok',
    testEventCode: null,
    advancedMatchingEnabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.META_EVENTS_START_AT
  dbMock.select.mockReset().mockReturnValue(chain([]))
  vi.mocked(claimPendingEvents).mockResolvedValue([])
  vi.mocked(hasScheduleForProspect).mockResolvedValue(false)
})

// ─── Tests ───────────────────────────────────────────────────────────

describe('GET /api/cron/meta-events', () => {
  describe('authentication', () => {
    it('returns 401 without the bearer token', async () => {
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
      expect(claimPendingEvents).not.toHaveBeenCalled()
    })

    it('returns 401 when the bearer token does not match CRON_SECRET', async () => {
      const res = await GET(makeRequest('wrong'))
      expect(res.status).toBe(401)
    })
  })

  describe('retry sweep', () => {
    it('retries a pending event and marks it sent', async () => {
      const event = makePendingEvent()
      vi.mocked(claimPendingEvents).mockResolvedValue([event])
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection() as never)
      vi.mocked(postEvents).mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-1' })

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(postEvents).toHaveBeenCalledWith(
        { datasetId: 'dataset-1', accessToken: 'tok', testEventCode: null },
        [event.payload],
      )
      expect(markEventSent).toHaveBeenCalledWith(TENANT_A, event.id, 'trace-1')
      expect(markEventFailure).not.toHaveBeenCalled()
      expect(json.retrySweep.sent).toBe(1)
    })

    it('moves a no-connection tenant\'s pending rows to skipped instead of leaving them pending', async () => {
      const events = [makePendingEvent({ id: 'evt-1' }), makePendingEvent({ id: 'evt-2' })]
      vi.mocked(claimPendingEvents).mockResolvedValue(events)
      vi.mocked(getMetaConnection).mockResolvedValue(null)

      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(postEvents).not.toHaveBeenCalled()
      expect(markEventSkipped).toHaveBeenCalledWith(TENANT_A, 'evt-1', 'no_connection')
      expect(markEventSkipped).toHaveBeenCalledWith(TENANT_A, 'evt-2', 'no_connection')
      expect(json.retrySweep.skippedNoConnection).toBe(2)
    })

    it('an auth failure marks the connection invalid and stops that tenant\'s batch', async () => {
      // 1500 events for one tenant: two batches of up to 1000. The second
      // batch must never be POSTed once the first comes back as an
      // expired/invalid token.
      const events = Array.from({ length: 1500 }, (_, i) => makePendingEvent({ id: `evt-${i}` }))
      vi.mocked(claimPendingEvents).mockResolvedValue(events)
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection() as never)
      vi.mocked(postEvents).mockResolvedValueOnce({ ok: false, kind: 'auth', message: 'token expired' })

      await GET(makeRequest(CRON_SECRET))

      expect(postEvents).toHaveBeenCalledTimes(1)
      expect(markConnectionInvalid).toHaveBeenCalledWith(TENANT_A, 'token expired')
      expect(markEventFailure).toHaveBeenCalledTimes(1000)
      expect(markEventSent).not.toHaveBeenCalled()
    })

    it('emits a Sentry warning when a tenant has more than 10 rows fail in one run', async () => {
      const events = Array.from({ length: 11 }, (_, i) =>
        makePendingEvent({ id: `evt-${i}`, attempts: 8 }),
      )
      vi.mocked(claimPendingEvents).mockResolvedValue(events)
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection() as never)
      vi.mocked(postEvents).mockResolvedValue({ ok: false, kind: 'invalid', message: 'bad field' })

      await GET(makeRequest(CRON_SECRET))

      expect(captureMessageMock).toHaveBeenCalledTimes(1)
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ level: 'warning', tags: { tenantId: TENANT_A } }),
      )
    })

    it('does not emit a Sentry warning at or below the 10-row threshold', async () => {
      const events = Array.from({ length: 10 }, (_, i) => makePendingEvent({ id: `evt-${i}` }))
      vi.mocked(claimPendingEvents).mockResolvedValue(events)
      vi.mocked(getMetaConnection).mockResolvedValue(makeConnection() as never)
      vi.mocked(postEvents).mockResolvedValue({ ok: false, kind: 'invalid', message: 'bad field' })

      await GET(makeRequest(CRON_SECRET))

      expect(captureMessageMock).not.toHaveBeenCalled()
    })
  })

  describe('reconciliation', () => {
    it('is skipped entirely when META_EVENTS_START_AT is unset', async () => {
      const res = await GET(makeRequest(CRON_SECRET))
      const json = await res.json()

      expect(json.reconciliation.skipped).toBe(true)
      expect(dbMock.select).not.toHaveBeenCalled()
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
            },
          ]),
        )

      vi.mocked(hasScheduleForProspect).mockResolvedValue(true)

      await GET(makeRequest(CRON_SECRET))

      expect(enqueueMetaEvent).not.toHaveBeenCalled()
    })
  })

  describe('computeReconciliationWindowStart', () => {
    it('ignores activities older than META_EVENTS_START_AT by using it as the window start', () => {
      const now = new Date('2026-08-28T12:00:00Z')
      const startAt = '2026-08-27T00:00:00Z' // 1 day ago, newer than 7 days ago

      const windowStart = computeReconciliationWindowStart(startAt, now)

      expect(windowStart.toISOString()).toBe('2026-08-27T00:00:00.000Z')
    })

    it('falls back to 7 days ago when META_EVENTS_START_AT predates it', () => {
      const now = new Date('2026-08-28T12:00:00Z')
      const startAt = '2020-01-01T00:00:00Z' // long before the 7-day floor

      const windowStart = computeReconciliationWindowStart(startAt, now)

      expect(windowStart.toISOString()).toBe('2026-08-21T12:00:00.000Z')
    })
  })
})

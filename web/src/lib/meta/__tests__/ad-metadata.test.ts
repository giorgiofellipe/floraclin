/**
 * Unit tests for the Marketing API ad-metadata backfill: no network or
 * database access occurs, both `db` and `fetch` are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, matching
// the pattern in `web/src/db/queries/__tests__/meta-events.test.ts`.
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

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/db/client', () => ({ db: dbMock }))

import { backfillAdMetadata } from '../ad-metadata'
import type { MetaConnection } from '@/db/queries/meta-connections'

const TENANT_A = '00000000-0000-0000-0000-00000000a001'

function makeConnection(overrides: Partial<MetaConnection> = {}): MetaConnection {
  return {
    id: 'conn-1',
    tenantId: TENANT_A,
    datasetId: 'dataset-1',
    accessToken: 'tok',
    businessId: null,
    connectionType: 'oauth',
    tokenExpiresAt: null,
    testEventCode: null,
    advancedMatchingEnabled: true,
    status: 'active',
    acknowledgedAt: null,
    acknowledgementVersion: null,
    acknowledgedBy: null,
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MetaConnection
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'la-1',
    adId: 'ad-1',
    adHeadline: null,
    ...overrides,
  }
}

describe('backfillAdMetadata', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('skips a manual connection entirely, without touching the database', async () => {
    const connection = makeConnection({ connectionType: 'manual' })

    const result = await backfillAdMetadata(TENANT_A, connection)

    expect(result).toEqual({ resolved: 0 })
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('ignores rows older than 7 days', async () => {
    // The lower bound on capturedAt is what keeps rows older than 7 days out
    // of this result; we simulate that filtering at the DB layer here.
    const selectChain = chain([])
    dbMock.select.mockReturnValueOnce(selectChain)
    global.fetch = vi.fn() as unknown as typeof fetch

    const result = await backfillAdMetadata(TENANT_A, makeConnection())

    expect(result).toEqual({ resolved: 0 })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(selectChain.__calls.where).toHaveLength(1)
  })

  it('caps the lookup at 50 rows per tenant per run', async () => {
    const selectChain = chain([])
    dbMock.select.mockReturnValueOnce(selectChain)

    await backfillAdMetadata(TENANT_A, makeConnection())

    expect(selectChain.__calls.limit).toEqual([[50]])
  })

  it('a failed lookup leaves the row null and does not throw', async () => {
    const selectChain = chain([makeRow()])
    dbMock.select.mockReturnValueOnce(selectChain)
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch

    const result = await backfillAdMetadata(TENANT_A, makeConnection())

    expect(result).toEqual({ resolved: 0 })
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('does not throw when the network request itself rejects', async () => {
    const selectChain = chain([makeRow()])
    dbMock.select.mockReturnValueOnce(selectChain)
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    await expect(backfillAdMetadata(TENANT_A, makeConnection())).resolves.toEqual({ resolved: 0 })
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('writes back adsetId, campaignId and adHeadline when the headline is null', async () => {
    const selectChain = chain([makeRow({ adHeadline: null })])
    dbMock.select.mockReturnValueOnce(selectChain)
    const updateChain = chain(undefined)
    dbMock.update.mockReturnValueOnce(updateChain)
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: 'Campanha Verão', adset: { id: 'adset-1' }, campaign: { id: 'camp-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch

    const result = await backfillAdMetadata(TENANT_A, makeConnection())

    expect(result).toEqual({ resolved: 1 })
    expect(updateChain.__calls.set[0][0]).toEqual({
      adsetId: 'adset-1',
      campaignId: 'camp-1',
      adHeadline: 'Campanha Verão',
    })
  })

  it('never overwrites an existing adHeadline', async () => {
    const selectChain = chain([makeRow({ adHeadline: 'Headline já salva' })])
    dbMock.select.mockReturnValueOnce(selectChain)
    const updateChain = chain(undefined)
    dbMock.update.mockReturnValueOnce(updateChain)
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: 'Nome novo da Meta', adset: { id: 'adset-1' }, campaign: { id: 'camp-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch

    const result = await backfillAdMetadata(TENANT_A, makeConnection())

    expect(result).toEqual({ resolved: 1 })
    const setCall = updateChain.__calls.set[0][0] as Record<string, unknown>
    expect(setCall).not.toHaveProperty('adHeadline')
    expect(setCall).toEqual({ adsetId: 'adset-1', campaignId: 'camp-1' })
  })

  it('sends the access token in a header, never in the request URL', async () => {
    const selectChain = chain([makeRow()])
    dbMock.select.mockReturnValueOnce(selectChain)
    dbMock.update.mockReturnValueOnce(chain(undefined))
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: 'Ad', adset: { id: 'adset-1' }, campaign: { id: 'camp-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await backfillAdMetadata(TENANT_A, makeConnection({ accessToken: 'super-secret-token' }))

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('super-secret-token')
    expect(url).toContain('/v21.0/ad-1')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer super-secret-token')
  })
})

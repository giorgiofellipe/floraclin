import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The other events tests stub `getMetaConnection`, so they cannot show what a
 * half-configured connection does to an event. This file runs the real query
 * over a fake db handle instead: authorizing OAuth without picking a dataset
 * must read as no connection all the way through to the outbox row.
 */

const insertConversionEventMock = vi.fn()
const postEventsMock = vi.fn()
const selectMock = vi.fn()

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

vi.mock('@/db/client', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
}))

vi.mock('@/db/schema', () => ({
  metaConnections: { tenantId: 'tenant_id' },
}))

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: (...args: unknown[]) => postEventsMock(...args),
}))

vi.mock('@/db/queries/meta-events', () => ({
  insertConversionEvent: (...args: unknown[]) => insertConversionEventMock(...args),
  markEventSent: vi.fn(),
  markEventFailure: vi.fn(),
  markEventSkipped: vi.fn(),
  claimEventForSending: vi.fn(async () => true),
  releaseEventClaims: vi.fn(),
}))

vi.mock('@/db/queries/lead-attributions', () => ({ getAttribution: vi.fn() }))
vi.mock('@/db/queries/marketing-consent', () => ({ isMarketingOptedOut: vi.fn(async () => false) }))
vi.mock('@/db/queries/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/db/queries/prospects', () => ({ getProspect: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))

const TENANT = 'tenant-1'

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: TENANT,
    datasetId: 'dataset-1',
    accessToken: 'tok-1',
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
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function input() {
  return {
    tenantId: TENANT,
    eventName: 'Purchase' as const,
    eventId: 'purchase:entry-1',
    eventTime: new Date('2026-08-20T12:00:00.000Z'),
    prospectId: null,
    patientId: 'patient-1',
    contact: { phone: '(47) 98844-3635', email: 'ana@clinica.com', fullName: 'Ana Souza' },
    actionSource: 'system_generated' as const,
    value: '250.00',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-1' })
})

describe('enqueueMetaEvent against a connection that has not picked a dataset', () => {
  // Fix 3: `skipped` here is terminal, and the cron's reconciliation left
  // join reads a skipped row as proof the event already exists, so every lead
  // between the two OAuth legs was lost the moment the clinic picked its
  // dataset. `pending` puts the row on the path the cron already has for a
  // tenant with no usable connection.
  it('writes a recoverable pending row and never posts to Meta', async () => {
    selectMock.mockReturnValue(makeChain([connectionRow({ status: 'pending_dataset', datasetId: null })]))
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(input())

    expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
    expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'pending', payload: null, value: '250.00' }),
    )
    expect(insertConversionEventMock.mock.calls[0][0]).not.toHaveProperty('skipReason')
    expect(postEventsMock).not.toHaveBeenCalled()
  })

  it('posts normally once the same connection is active with a dataset', async () => {
    selectMock.mockReturnValue(makeChain([connectionRow()]))
    postEventsMock.mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-1' })
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(input())

    expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'pending' }),
    )
    expect(postEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'dataset-1' }),
      expect.any(Array),
    )
  })
})

/**
 * A patient who opted out of ad measurement must never be silently skipped:
 * the outbox row is the evidence, under audit, that the opt-out was
 * honoured. This exercises the real `isMarketingOptedOut` query against a
 * mocked db, so the test fails if the patient's `marketingOptOut` column
 * ever stops reaching `enqueueMetaEvent`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertConversionEventMock = vi.fn()
const getMetaConnectionMock = vi.fn()
const postEventsMock = vi.fn()
const getAttributionMock = vi.fn()
const reportSideEffectFailureMock = vi.fn()

vi.mock('@/db/queries/meta-events', () => ({
  insertConversionEvent: (...args: unknown[]) => insertConversionEventMock(...args),
  markEventSent: vi.fn(),
  markEventFailure: vi.fn(),
}))

vi.mock('@/db/queries/meta-connections', () => ({
  getMetaConnection: (...args: unknown[]) => getMetaConnectionMock(...args),
  markConnectionInvalid: vi.fn(),
}))

vi.mock('@/db/queries/lead-attributions', () => ({
  getAttribution: (...args: unknown[]) => getAttributionMock(...args),
}))

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: (...args: unknown[]) => postEventsMock(...args),
}))

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

// Real `isMarketingOptedOut` runs against this fake db, so the test proves
// the patient row's `marketingOptOut` column actually drives the outcome,
// not just that a mocked check does.
const patientRow = { marketingOptOut: true }
vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([patientRow]),
        })),
      })),
    })),
  },
}))

const TENANT = 'tenant-1'
const PATIENT = 'patient-1'

describe('opted-out patient and the Meta conversion outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_EXTERNAL_ID_SECRET = 'a'.repeat(64)
    patientRow.marketingOptOut = true
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-1' })
    getMetaConnectionMock.mockResolvedValue({
      tenantId: TENANT,
      datasetId: 'dataset-1',
      accessToken: 'tok-1',
      testEventCode: null,
      advancedMatchingEnabled: true,
    })
    getAttributionMock.mockResolvedValue(null)
  })

  it('writes a skipped row with reason opted_out instead of no row at all', async () => {
    const { enqueueMetaEvent } = await import('@/lib/meta/events')

    await enqueueMetaEvent({
      tenantId: TENANT,
      eventName: 'Contact',
      eventId: `contact:${PATIENT}`,
      eventTime: new Date('2026-08-20T12:00:00.000Z'),
      prospectId: null,
      patientId: PATIENT,
      contact: { phone: '5547988443635', email: 'ana@clinica.com', fullName: 'Ana Souza' },
      actionSource: 'website',
    })

    expect(insertConversionEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        eventName: 'Contact',
        status: 'skipped',
        skipReason: 'opted_out',
        payload: null,
      }),
      undefined,
    )
    // Never reaches the connection lookup or Meta: the opt-out check runs first.
    expect(getMetaConnectionMock).not.toHaveBeenCalled()
    expect(postEventsMock).not.toHaveBeenCalled()
  })
})

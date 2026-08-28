import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashEmail, hashName, hashPhone, splitFullName } from '../hashing'
import type { MetaEventPayload } from '../types'

const postEventsMock = vi.fn()
const insertConversionEventMock = vi.fn()
const markEventSentMock = vi.fn()
const markEventFailureMock = vi.fn()
const getMetaConnectionMock = vi.fn()
const markConnectionInvalidMock = vi.fn()
const getAttributionMock = vi.fn()
const isMarketingOptedOutMock = vi.fn()
const reportSideEffectFailureMock = vi.fn()

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: (...args: unknown[]) => postEventsMock(...args),
}))

vi.mock('@/db/queries/meta-events', () => ({
  insertConversionEvent: (...args: unknown[]) => insertConversionEventMock(...args),
  markEventSent: (...args: unknown[]) => markEventSentMock(...args),
  markEventFailure: (...args: unknown[]) => markEventFailureMock(...args),
}))

vi.mock('@/db/queries/meta-connections', () => ({
  getMetaConnection: (...args: unknown[]) => getMetaConnectionMock(...args),
  markConnectionInvalid: (...args: unknown[]) => markConnectionInvalidMock(...args),
}))

vi.mock('@/db/queries/lead-attributions', () => ({
  getAttribution: (...args: unknown[]) => getAttributionMock(...args),
}))

vi.mock('@/db/queries/marketing-consent', () => ({
  isMarketingOptedOut: (...args: unknown[]) => isMarketingOptedOutMock(...args),
}))

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

const TENANT = 'tenant-1'
const PROSPECT = 'prospect-1'

const CONNECTION = {
  tenantId: TENANT,
  datasetId: 'dataset-1',
  accessToken: 'tok-1',
  testEventCode: null,
  advancedMatchingEnabled: true,
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    eventName: 'Lead' as const,
    eventId: 'lead:prospect-1',
    eventTime: new Date('2026-08-20T12:00:00.000Z'),
    prospectId: PROSPECT,
    contact: { phone: '(47) 98844-3635', email: 'Ana@Clinica.com', fullName: 'Ana Souza' },
    actionSource: 'website' as const,
    ...overrides,
  }
}

function insertedPayload(): MetaEventPayload {
  const call = insertConversionEventMock.mock.calls[0][0] as { payload: MetaEventPayload }
  return call.payload
}

describe('enqueueMetaEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_EXTERNAL_ID_SECRET = 'f'.repeat(64)

    isMarketingOptedOutMock.mockResolvedValue(false)
    getMetaConnectionMock.mockResolvedValue(CONNECTION)
    getAttributionMock.mockResolvedValue(null)
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-1' })
    postEventsMock.mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-1' })
  })

  // 1. Never throws.
  it('never throws when a dependency throws, and reports the failure', async () => {
    const { enqueueMetaEvent } = await import('../events')
    isMarketingOptedOutMock.mockRejectedValue(new Error('db is down'))

    await expect(enqueueMetaEvent(baseInput())).resolves.toBeUndefined()

    expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
    const [error, context] = reportSideEffectFailureMock.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect(context).toEqual(expect.objectContaining({ area: 'meta-capi', step: expect.any(String) }))
  })

  it('never throws when the outbox insert itself throws', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockRejectedValue(new Error('unique violation'))

    await expect(enqueueMetaEvent(baseInput())).resolves.toBeUndefined()
    expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
  })

  // 2. No connection.
  it('writes a skipped row with reason no_connection and never posts when there is no connection', async () => {
    const { enqueueMetaEvent } = await import('../events')
    getMetaConnectionMock.mockResolvedValue(null)

    await enqueueMetaEvent(baseInput())

    expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
    expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'skipped', skipReason: 'no_connection', payload: null }),
    )
    expect(postEventsMock).not.toHaveBeenCalled()
  })

  // 3. Opted out.
  it('writes a skipped row with reason opted_out and never hashes contact data', async () => {
    const { enqueueMetaEvent } = await import('../events')
    isMarketingOptedOutMock.mockResolvedValue(true)
    const hashPhoneSpy = vi.spyOn(await import('../hashing'), 'hashPhone')

    await enqueueMetaEvent(baseInput())

    expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
    expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'skipped', skipReason: 'opted_out', payload: null }),
    )
    expect(postEventsMock).not.toHaveBeenCalled()
    expect(getMetaConnectionMock).not.toHaveBeenCalled()
    expect(hashPhoneSpy).not.toHaveBeenCalled()
    hashPhoneSpy.mockRestore()
  })

  it('resolves the opt-out internally rather than from a caller-supplied flag', async () => {
    const { enqueueMetaEvent } = await import('../events')
    isMarketingOptedOutMock.mockResolvedValue(true)

    await enqueueMetaEvent(baseInput())

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, { prospectId: PROSPECT })
  })

  // 3b. tx supplied.
  it('with tx supplied, inserts the outbox row on that tx and returns without posting', async () => {
    const { enqueueMetaEvent } = await import('../events')
    const fakeTx = { marker: 'tx' } as never
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-tx' })

    await enqueueMetaEvent(baseInput({ tx: fakeTx }))

    expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
    expect(insertConversionEventMock.mock.calls[0][1]).toBe(fakeTx)
    expect(postEventsMock).not.toHaveBeenCalled()
    expect(markEventSentMock).not.toHaveBeenCalled()
    expect(markEventFailureMock).not.toHaveBeenCalled()
  })

  // 4. Advanced matching disabled.
  it('sends only external_id, click ids, ip and user agent when advanced matching is disabled', async () => {
    const { enqueueMetaEvent } = await import('../events')
    getMetaConnectionMock.mockResolvedValue({ ...CONNECTION, advancedMatchingEnabled: false })
    getAttributionMock.mockResolvedValue({
      ctwaClid: 'clid-1',
      fbc: 'fb.1.111.abc',
      fbp: 'fb.1.222.def',
      clientIp: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    })

    await enqueueMetaEvent(baseInput())

    const userData = insertedPayload().user_data
    expect(userData.em).toBeUndefined()
    expect(userData.ph).toBeUndefined()
    expect(userData.fn).toBeUndefined()
    expect(userData.ln).toBeUndefined()
    expect(userData.external_id).toBeDefined()
    expect(userData.ctwa_clid).toBe('clid-1')
    expect(userData.fbc).toBe('fb.1.111.abc')
    expect(userData.fbp).toBe('fb.1.222.def')
    expect(userData.client_ip_address).toBe('1.2.3.4')
    expect(userData.client_user_agent).toBe('Mozilla/5.0')
  })

  // 5. action_source is always the caller's; messaging_channel iff business_messaging; ctwa_clid unhashed regardless.
  it('never infers action_source from attribution, and only sets messaging_channel for business_messaging', async () => {
    const { enqueueMetaEvent } = await import('../events')
    getAttributionMock.mockResolvedValue({ ctwaClid: 'clid-9' })

    await enqueueMetaEvent(baseInput({ actionSource: 'system_generated', eventId: 'lead:a' }))
    expect(insertedPayload().action_source).toBe('system_generated')
    expect(insertedPayload().messaging_channel).toBeUndefined()
    expect(insertedPayload().user_data.ctwa_clid).toBe('clid-9')

    insertConversionEventMock.mockClear()
    await enqueueMetaEvent(baseInput({ actionSource: 'business_messaging', eventId: 'lead:b' }))
    expect(insertedPayload().action_source).toBe('business_messaging')
    expect(insertedPayload().messaging_channel).toBe('whatsapp')
    expect(insertedPayload().user_data.ctwa_clid).toBe('clid-9')
  })

  it('places ctwa_clid unhashed in user_data', async () => {
    const { enqueueMetaEvent } = await import('../events')
    getAttributionMock.mockResolvedValue({ ctwaClid: 'raw-click-id-not-a-hash' })

    await enqueueMetaEvent(baseInput())

    expect(insertedPayload().user_data.ctwa_clid).toBe('raw-click-id-not-a-hash')
  })

  // 6. Advanced matching sent even alongside a click id.
  it('sends hashed contact fields together with a click id when advanced matching is enabled', async () => {
    const { enqueueMetaEvent } = await import('../events')
    getAttributionMock.mockResolvedValue({ ctwaClid: 'clid-1' })

    await enqueueMetaEvent(
      baseInput({ eventName: 'Purchase', eventId: 'purchase:1', value: '150.00' }),
    )

    const userData = insertedPayload().user_data
    expect(userData.ctwa_clid).toBe('clid-1')
    expect(userData.em).toEqual([hashEmail('Ana@Clinica.com')])
    expect(userData.ph).toEqual([hashPhone('(47) 98844-3635')])
    const { first, last } = splitFullName('Ana Souza')
    expect(userData.fn).toEqual([hashName(first)])
    expect(userData.ln).toEqual([hashName(last)])
  })

  // 7. external_id is an opaque per-tenant HMAC of the prospect id.
  it('computes external_id as an HMAC-SHA256 of tenantId:prospectId keyed by the secret', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput())

    const expected = createHmac('sha256', process.env.META_EXTERNAL_ID_SECRET!)
      .update(`${TENANT}:${PROSPECT}`)
      .digest('hex')
    expect(insertedPayload().user_data.external_id).toEqual([expected])
  })

  it('produces a different external_id for the same prospect id under a different tenant', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput())
    const first = insertedPayload().user_data.external_id?.[0]

    insertConversionEventMock.mockClear()
    await enqueueMetaEvent(baseInput({ tenantId: 'tenant-2' }))
    const second = insertedPayload().user_data.external_id?.[0]

    expect(first).not.toBe(second)
  })

  // 8. Duplicate eventId is a no-op.
  it('never posts when insertConversionEvent reports the row already existed', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockResolvedValue({ inserted: false, id: 'evt-existing' })

    await enqueueMetaEvent(baseInput({ eventName: 'Purchase', eventId: 'purchase:entry-1', value: '10.00' }))
    await enqueueMetaEvent(baseInput({ eventName: 'Purchase', eventId: 'purchase:entry-1', value: '10.00' }))

    expect(postEventsMock).not.toHaveBeenCalled()
    expect(markEventSentMock).not.toHaveBeenCalled()
    expect(markEventFailureMock).not.toHaveBeenCalled()
  })

  // 9. Success marks the row sent with the returned fbTraceId and the id insertConversionEvent gave back.
  it('marks the row sent with the fbTraceId on a successful post', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-42' })
    postEventsMock.mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-42' })

    await enqueueMetaEvent(baseInput())

    expect(markEventSentMock).toHaveBeenCalledWith(TENANT, 'evt-42', 'trace-42')
  })

  // 10. Transient failure leaves the row pending and does not throw.
  it('records a transient failure without throwing and without invalidating the connection', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-transient' })
    postEventsMock.mockResolvedValue({ ok: false, kind: 'transient', message: 'timeout' })

    await expect(enqueueMetaEvent(baseInput())).resolves.toBeUndefined()

    expect(markEventFailureMock).toHaveBeenCalledWith(TENANT, 'evt-transient', 'transient', 'timeout')
    expect(markConnectionInvalidMock).not.toHaveBeenCalled()
    expect(reportSideEffectFailureMock).not.toHaveBeenCalled()
  })

  // 11. Auth failure marks the connection invalid.
  it('marks the connection invalid on an auth failure', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-auth' })
    postEventsMock.mockResolvedValue({ ok: false, kind: 'auth', message: 'token expired' })

    await enqueueMetaEvent(baseInput())

    expect(markConnectionInvalidMock).toHaveBeenCalledWith(TENANT, 'token expired')
    expect(markEventFailureMock).toHaveBeenCalledWith(TENANT, 'evt-auth', 'auth', 'token expired')
  })

  it('marks the row failed on an invalid payload without touching the connection', async () => {
    const { enqueueMetaEvent } = await import('../events')
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-invalid' })
    postEventsMock.mockResolvedValue({ ok: false, kind: 'invalid', message: 'bad field' })

    await enqueueMetaEvent(baseInput())

    expect(markEventFailureMock).toHaveBeenCalledWith(TENANT, 'evt-invalid', 'invalid', 'bad field')
    expect(markConnectionInvalidMock).not.toHaveBeenCalled()
  })

  // 12. value only present on Purchase, sent as a number with currency BRL.
  it('sends value as a number with currency BRL only for Purchase', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(
      baseInput({ eventName: 'Purchase', eventId: 'purchase:1', value: '199.90' }),
    )

    expect(insertedPayload().custom_data).toEqual({ value: 199.9, currency: 'BRL' })
  })

  it('never sends custom_data.value for a non-Purchase event, even if a value is supplied', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput({ eventName: 'Contact', eventId: 'contact:1', value: '199.90' }))

    expect(insertedPayload().custom_data).toBeUndefined()
  })
})

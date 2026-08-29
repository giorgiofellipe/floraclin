import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashEmail, hashName, hashPhone, splitFullName } from '../hashing'
import type { MetaEventPayload } from '../types'

const postEventsMock = vi.fn()
const insertConversionEventMock = vi.fn()
const markEventSentMock = vi.fn()
const markEventFailureMock = vi.fn()
const markEventSkippedMock = vi.fn()
const getMetaConnectionMock = vi.fn()
const markConnectionInvalidMock = vi.fn()
const getAttributionMock = vi.fn()
const isMarketingOptedOutMock = vi.fn()
const getPatientMock = vi.fn()
const getProspectMock = vi.fn()
const reportSideEffectFailureMock = vi.fn()

vi.mock('@/lib/meta/capi-client', () => ({
  postEvents: (...args: unknown[]) => postEventsMock(...args),
}))

vi.mock('@/db/queries/meta-events', () => ({
  insertConversionEvent: (...args: unknown[]) => insertConversionEventMock(...args),
  markEventSent: (...args: unknown[]) => markEventSentMock(...args),
  markEventFailure: (...args: unknown[]) => markEventFailureMock(...args),
  markEventSkipped: (...args: unknown[]) => markEventSkippedMock(...args),
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

vi.mock('@/db/queries/patients', () => ({
  getPatient: (...args: unknown[]) => getPatientMock(...args),
}))

vi.mock('@/db/queries/prospects', () => ({
  getProspect: (...args: unknown[]) => getProspectMock(...args),
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

function postedPayload(): MetaEventPayload {
  return (postEventsMock.mock.calls[0][1] as MetaEventPayload[])[0]
}

describe('enqueueMetaEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_EXTERNAL_ID_SECRET = 'f'.repeat(64)

    isMarketingOptedOutMock.mockResolvedValue(false)
    getMetaConnectionMock.mockResolvedValue(CONNECTION)
    getAttributionMock.mockResolvedValue(null)
    getPatientMock.mockResolvedValue(null)
    getProspectMock.mockResolvedValue(null)
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-1' })
    postEventsMock.mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-1' })
  })

  it('passes patientId to the opt-out check so a walk-in Purchase can be suppressed', async () => {
    const { enqueueMetaEvent } = await import('../events')
    isMarketingOptedOutMock.mockResolvedValue(true)

    await enqueueMetaEvent(
      baseInput({
        eventName: 'Purchase',
        eventId: 'purchase:entry-1',
        prospectId: null,
        patientId: 'patient-1',
        value: '3000.00',
      }),
    )

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: 'patient-1',
      phone: '(47) 98844-3635',
    })
    expect(postEventsMock).not.toHaveBeenCalled()
  })

  it('forwards patientId on the happy path so the patient flag is always consulted', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput({ patientId: 'patient-1' }))

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: 'patient-1',
      phone: '(47) 98844-3635',
    })
  })

  // The leak an opted-out patient used to walk through: no patient link at
  // all, only the phone the prospect wrote in from.
  it('passes the contact phone to the opt-out check when there is no patient id', async () => {
    const { enqueueMetaEvent } = await import('../events')
    isMarketingOptedOutMock.mockResolvedValue(true)

    await enqueueMetaEvent(baseInput())

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: undefined,
      phone: '(47) 98844-3635',
    })
    expect(postEventsMock).not.toHaveBeenCalled()
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

    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: undefined,
      phone: '(47) 98844-3635',
    })
  })

  // 3b. tx supplied.
  it('with tx and prerequisites, inserts the outbox row on that tx and returns without posting', async () => {
    const { enqueueMetaEvent } = await import('../events')
    const fakeTx = { marker: 'tx' } as never
    insertConversionEventMock.mockResolvedValue({ inserted: true, id: 'evt-tx' })

    await enqueueMetaEvent(
      baseInput({
        tx: fakeTx,
        prerequisites: { optedOut: false, connection: CONNECTION, attribution: null },
      }),
    )

    expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
    expect(insertConversionEventMock.mock.calls[0][1]).toBe(fakeTx)
    expect(postEventsMock).not.toHaveBeenCalled()
    expect(markEventSentMock).not.toHaveBeenCalled()
    expect(markEventFailureMock).not.toHaveBeenCalled()
  })

  // Fix 1: a pre-transaction lookup that never ran must not cost the event.
  describe('tx with no prerequisites', () => {
    it('inserts a bare pending row on the caller transaction and reads nothing', async () => {
      const { enqueueMetaEvent } = await import('../events')
      const fakeTx = { marker: 'tx' } as never

      await enqueueMetaEvent(
        baseInput({ eventName: 'Purchase', eventId: 'purchase:entry-1', value: '3000.00', tx: fakeTx }),
      )

      expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
      expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          status: 'pending',
          payload: null,
          value: '3000.00',
          eventId: 'purchase:entry-1',
          prospectId: PROSPECT,
        }),
      )
      expect(insertConversionEventMock.mock.calls[0][1]).toBe(fakeTx)
      expect(isMarketingOptedOutMock).not.toHaveBeenCalled()
      expect(getMetaConnectionMock).not.toHaveBeenCalled()
      expect(getAttributionMock).not.toHaveBeenCalled()
      expect(postEventsMock).not.toHaveBeenCalled()
    })

    it('carries no value for a non-Purchase event', async () => {
      const { enqueueMetaEvent } = await import('../events')
      const fakeTx = { marker: 'tx' } as never

      await enqueueMetaEvent(baseInput({ value: '99.00', tx: fakeTx }))

      expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ value: null }),
      )
    })

    it('still writes the row when the external id secret is missing, so nothing is lost', async () => {
      const { enqueueMetaEvent } = await import('../events')
      delete process.env.META_EXTERNAL_ID_SECRET
      const fakeTx = { marker: 'tx' } as never

      await expect(enqueueMetaEvent(baseInput({ tx: fakeTx }))).resolves.toBeUndefined()

      expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ status: 'pending', payload: null }),
      )
      expect(insertConversionEventMock.mock.calls[0][1]).toBe(fakeTx)
    })
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

  // Fix 2: the outbox row stores the action source, so a rebuild does not
  // have to guess it.
  it('persists the action source on the outbox row', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput({ actionSource: 'business_messaging' }))

    expect(insertConversionEventMock.mock.calls[0][0]).toMatchObject({
      actionSource: 'business_messaging',
    })
  })

  it('persists the action source even on a bare row written inside a transaction', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(
      baseInput({
        eventName: 'Purchase',
        eventId: 'purchase:entry-1',
        value: '10.00',
        actionSource: 'business_messaging',
        tx: {} as never,
      }),
    )

    expect(insertConversionEventMock.mock.calls[0][0]).toMatchObject({
      payload: null,
      actionSource: 'business_messaging',
    })
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

  it('posts the payload it stored, without rebuilding it', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(baseInput())

    expect(postedPayload()).toEqual(insertedPayload())
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

  // 13. Errors on the transactional path must not be swallowed: the caller
  // owns the transaction and is the only one that knows what the failure
  // costs. The payment path hands in a savepoint and absorbs the throw there.
  it('re-raises when tx is supplied and the outbox insert fails, so the caller can decide', async () => {
    const { enqueueMetaEvent } = await import('../events')
    const fakeTx = { marker: 'tx' } as never
    insertConversionEventMock.mockRejectedValue(new Error('current transaction is aborted'))

    await expect(enqueueMetaEvent(baseInput({ tx: fakeTx }))).rejects.toThrow(
      'current transaction is aborted',
    )
    expect(reportSideEffectFailureMock).not.toHaveBeenCalled()
  })

  // 14. Caller-supplied prerequisites replace every read.
  it('issues no reads of its own when the caller supplies prerequisites', async () => {
    const { enqueueMetaEvent } = await import('../events')
    const fakeTx = { marker: 'tx' } as never

    await enqueueMetaEvent(
      baseInput({
        tx: fakeTx,
        prerequisites: {
          optedOut: false,
          connection: CONNECTION,
          attribution: {
            ctwaClid: 'clid-tx',
            fbc: null,
            fbp: null,
            clientIp: null,
            userAgent: null,
          },
        },
      }),
    )

    expect(isMarketingOptedOutMock).not.toHaveBeenCalled()
    expect(getMetaConnectionMock).not.toHaveBeenCalled()
    expect(getAttributionMock).not.toHaveBeenCalled()
    expect(insertedPayload().user_data.ctwa_clid).toBe('clid-tx')
  })

  it('honours a supplied opted-out prerequisite without consulting the database', async () => {
    const { enqueueMetaEvent } = await import('../events')

    await enqueueMetaEvent(
      baseInput({ prerequisites: { optedOut: true, connection: null, attribution: null } }),
    )

    expect(isMarketingOptedOutMock).not.toHaveBeenCalled()
    expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'skipped', skipReason: 'opted_out' }),
    )
    expect(postEventsMock).not.toHaveBeenCalled()
  })

  describe('resolveMetaEventPrerequisites', () => {
    it('stops at the opt-out check so an opted-out prospect costs one read', async () => {
      const { resolveMetaEventPrerequisites } = await import('../events')
      isMarketingOptedOutMock.mockResolvedValue(true)

      const prerequisites = await resolveMetaEventPrerequisites(TENANT, { prospectId: PROSPECT })

      expect(prerequisites).toEqual({ optedOut: true, connection: null, attribution: null })
      expect(getMetaConnectionMock).not.toHaveBeenCalled()
      expect(getAttributionMock).not.toHaveBeenCalled()
    })

    it('reads the attribution only when there is a prospect', async () => {
      const { resolveMetaEventPrerequisites } = await import('../events')

      await resolveMetaEventPrerequisites(TENANT, { patientId: 'patient-1', prospectId: null })

      expect(getAttributionMock).not.toHaveBeenCalled()
    })

    it('forwards the phone to the opt-out check', async () => {
      const { resolveMetaEventPrerequisites } = await import('../events')

      await resolveMetaEventPrerequisites(TENANT, { prospectId: PROSPECT, phone: '5547988443635' })

      expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
        patientId: undefined,
        phone: '5547988443635',
      })
    })
  })

  // 15. A missing external id secret is recorded, never dropped.
  describe('META_EXTERNAL_ID_SECRET', () => {
    it('writes a skipped row and reports, rather than losing an attributed event entirely', async () => {
      const { enqueueMetaEvent } = await import('../events')
      delete process.env.META_EXTERNAL_ID_SECRET

      await enqueueMetaEvent(baseInput())

      expect(insertConversionEventMock).toHaveBeenCalledTimes(1)
      expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          status: 'skipped',
          skipReason: 'no_external_id_secret',
          payload: null,
        }),
      )
      expect(postEventsMock).not.toHaveBeenCalled()
    })

    it('still sends an event with no prospect, since it needs no external_id', async () => {
      const { enqueueMetaEvent } = await import('../events')
      delete process.env.META_EXTERNAL_ID_SECRET

      await enqueueMetaEvent(baseInput({ prospectId: null, patientId: 'patient-1' }))

      expect(insertConversionEventMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ status: 'pending' }),
      )
      expect(insertedPayload().user_data.external_id).toBeUndefined()
      expect(postEventsMock).toHaveBeenCalledTimes(1)
    })
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

describe('sendPendingEvent', () => {
  const STORED_PAYLOAD: MetaEventPayload = {
    event_name: 'Lead',
    event_time: 1_755_000_000,
    event_id: 'lead:prospect-1',
    action_source: 'website',
    user_data: { em: ['already-hashed'] },
  }

  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'evt-1',
      tenantId: TENANT,
      prospectId: PROSPECT,
      patientId: null,
      eventName: 'Lead' as const,
      eventId: 'lead:prospect-1',
      eventTime: new Date('2026-08-20T12:00:00.000Z'),
      value: null,
      actionSource: null,
      payload: STORED_PAYLOAD as unknown,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_EXTERNAL_ID_SECRET = 'f'.repeat(64)

    isMarketingOptedOutMock.mockResolvedValue(false)
    getMetaConnectionMock.mockResolvedValue(CONNECTION)
    getAttributionMock.mockResolvedValue(null)
    getPatientMock.mockResolvedValue(null)
    getProspectMock.mockResolvedValue(null)
    postEventsMock.mockResolvedValue({ ok: true, eventsReceived: 1, fbTraceId: 'trace-1' })
  })

  it('posts the stored payload and marks the row sent', async () => {
    const { sendPendingEvent } = await import('../events')

    await sendPendingEvent(pendingRow())

    expect(postEventsMock).toHaveBeenCalledTimes(1)
    expect(postedPayload()).toEqual(STORED_PAYLOAD)
    expect(markEventSentMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'trace-1')
  })

  it('leaves the row pending and posts nothing when the tenant has no connection', async () => {
    const { sendPendingEvent } = await import('../events')
    getMetaConnectionMock.mockResolvedValue(null)

    await sendPendingEvent(pendingRow())

    expect(postEventsMock).not.toHaveBeenCalled()
    expect(markEventSkippedMock).not.toHaveBeenCalled()
    expect(markEventFailureMock).not.toHaveBeenCalled()
    expect(markEventSentMock).not.toHaveBeenCalled()
  })

  // Fix 3: a patient who opts out during a Meta outage must not be sent by
  // the next sweep, even though the payload was built before they opted out.
  it('re-checks the opt-out and skips instead of sending when it now says suppressed', async () => {
    const { sendPendingEvent } = await import('../events')
    isMarketingOptedOutMock.mockResolvedValue(true)

    await sendPendingEvent(pendingRow({ patientId: 'patient-1' }))

    expect(markEventSkippedMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'opted_out')
    expect(postEventsMock).not.toHaveBeenCalled()
    expect(markEventSentMock).not.toHaveBeenCalled()
  })

  it('resolves the prospect phone for the opt-out re-check when the row has no patient id', async () => {
    const { sendPendingEvent } = await import('../events')
    getProspectMock.mockResolvedValue({ id: PROSPECT, phone: '5547988443635', name: 'Ana Souza' })

    await sendPendingEvent(pendingRow())

    expect(getProspectMock).toHaveBeenCalledWith(TENANT, PROSPECT)
    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: null,
      phone: '5547988443635',
    })
  })

  it('prefers the patient record over the prospect for the opt-out re-check', async () => {
    const { sendPendingEvent } = await import('../events')
    getPatientMock.mockResolvedValue({
      phone: '(47) 98844-3635',
      email: 'ana@clinica.com',
      fullName: 'Ana Souza',
    })

    await sendPendingEvent(pendingRow({ patientId: 'patient-1' }))

    expect(getProspectMock).not.toHaveBeenCalled()
    expect(isMarketingOptedOutMock).toHaveBeenCalledWith(TENANT, {
      patientId: 'patient-1',
      phone: '(47) 98844-3635',
    })
  })

  describe('rebuilding a bare row', () => {
    function bareRow(overrides: Record<string, unknown> = {}) {
      return pendingRow({
        eventName: 'Purchase' as const,
        eventId: 'purchase:entry-1',
        value: '3000.00',
        actionSource: 'system_generated' as const,
        payload: null,
        patientId: 'patient-1',
        ...overrides,
      })
    }

    beforeEach(() => {
      getPatientMock.mockResolvedValue({
        phone: '(47) 98844-3635',
        email: 'Ana@Clinica.com',
        fullName: 'Ana Souza',
      })
    })

    it('builds the payload from the patient, the attribution and the row value', async () => {
      const { sendPendingEvent } = await import('../events')
      getAttributionMock.mockResolvedValue({
        ctwaClid: 'clid-1',
        fbc: null,
        fbp: null,
        clientIp: null,
        userAgent: null,
      })

      await sendPendingEvent(bareRow())

      const payload = postedPayload()
      expect(payload.event_name).toBe('Purchase')
      expect(payload.event_id).toBe('purchase:entry-1')
      expect(payload.action_source).toBe('system_generated')
      expect(payload.custom_data).toEqual({ value: 3000, currency: 'BRL' })
      expect(payload.user_data.ctwa_clid).toBe('clid-1')
      expect(payload.user_data.em).toEqual([hashEmail('Ana@Clinica.com')])
      expect(payload.user_data.ph).toEqual([hashPhone('(47) 98844-3635')])
      expect(payload.user_data.external_id).toEqual([
        createHmac('sha256', process.env.META_EXTERNAL_ID_SECRET!)
          .update(`${TENANT}:${PROSPECT}`)
          .digest('hex'),
      ])
      expect(markEventSentMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'trace-1')
    })

    it('omits the hashed contact fields when advanced matching is disabled', async () => {
      const { sendPendingEvent } = await import('../events')
      getMetaConnectionMock.mockResolvedValue({ ...CONNECTION, advancedMatchingEnabled: false })

      await sendPendingEvent(bareRow())

      expect(postedPayload().user_data.em).toBeUndefined()
      expect(postedPayload().user_data.ph).toBeUndefined()
      expect(postedPayload().user_data.external_id).toBeDefined()
    })

    it('skips with no_external_id_secret rather than posting an unmatchable event', async () => {
      const { sendPendingEvent } = await import('../events')
      delete process.env.META_EXTERNAL_ID_SECRET

      await sendPendingEvent(bareRow())

      expect(markEventSkippedMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'no_external_id_secret')
      expect(postEventsMock).not.toHaveBeenCalled()
    })

    // Fix 2: Meta reads ctwa_clid only alongside business_messaging, so a
    // rebuilt CTWA row must carry the source the emitting site chose.
    it('rebuilds with the stored action source and sets messaging_channel with it', async () => {
      const { sendPendingEvent } = await import('../events')
      getAttributionMock.mockResolvedValue({ ctwaClid: 'clid-1' })

      await sendPendingEvent(bareRow({ actionSource: 'business_messaging', eventName: 'Lead', eventId: 'lead:1' }))

      expect(postedPayload().action_source).toBe('business_messaging')
      expect(postedPayload().messaging_channel).toBe('whatsapp')
      expect(postedPayload().user_data.ctwa_clid).toBe('clid-1')
    })

    it('never sets messaging_channel for a stored source other than business_messaging', async () => {
      const { sendPendingEvent } = await import('../events')

      await sendPendingEvent(bareRow({ actionSource: 'website' }))

      expect(postedPayload().action_source).toBe('website')
      expect(postedPayload().messaging_channel).toBeUndefined()
    })

    it('falls back to system_generated for a row written before the column existed', async () => {
      const { sendPendingEvent } = await import('../events')

      await sendPendingEvent(bareRow({ actionSource: null }))

      expect(postedPayload().action_source).toBe('system_generated')
      expect(postedPayload().messaging_channel).toBeUndefined()
    })

    it('sends a row with no prospect even without the secret, since it needs no external_id', async () => {
      const { sendPendingEvent } = await import('../events')
      delete process.env.META_EXTERNAL_ID_SECRET

      await sendPendingEvent(bareRow({ prospectId: null }))

      expect(postEventsMock).toHaveBeenCalledTimes(1)
      expect(postedPayload().user_data.external_id).toBeUndefined()
      expect(getAttributionMock).not.toHaveBeenCalled()
    })
  })

  it('marks the connection invalid and the row failed on an auth failure', async () => {
    const { sendPendingEvent } = await import('../events')
    postEventsMock.mockResolvedValue({ ok: false, kind: 'auth', message: 'token expired' })

    await sendPendingEvent(pendingRow())

    expect(markConnectionInvalidMock).toHaveBeenCalledWith(TENANT, 'token expired')
    expect(markEventFailureMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'auth', 'token expired')
  })

  it('records a transient failure without invalidating the connection', async () => {
    const { sendPendingEvent } = await import('../events')
    postEventsMock.mockResolvedValue({ ok: false, kind: 'transient', message: 'timeout' })

    await sendPendingEvent(pendingRow())

    expect(markEventFailureMock).toHaveBeenCalledWith(TENANT, 'evt-1', 'transient', 'timeout')
    expect(markConnectionInvalidMock).not.toHaveBeenCalled()
  })
})

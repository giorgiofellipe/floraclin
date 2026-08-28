import { createHmac } from 'node:crypto'

import type { db } from '@/db/client'
import { getMetaConnection, markConnectionInvalid } from '@/db/queries/meta-connections'
import { insertConversionEvent, markEventFailure, markEventSent } from '@/db/queries/meta-events'
import { getAttribution } from '@/db/queries/lead-attributions'
import { isMarketingOptedOut } from '@/db/queries/marketing-consent'
import { reportSideEffectFailure } from '@/lib/observability'

import { postEvents } from './capi-client'
import { hashEmail, hashName, hashPhone, splitFullName } from './hashing'
import type { MetaActionSource, MetaEventName, MetaEventPayload, MetaUserData } from './types'

/** The attribution columns an event payload reads. */
export interface MetaAttributionSignals {
  ctwaClid: string | null
  fbc: string | null
  fbp: string | null
  clientIp: string | null
  userAgent: string | null
}

export interface MetaEventConnection {
  datasetId: string
  accessToken: string
  testEventCode: string | null
  advancedMatchingEnabled: boolean
}

/**
 * The three reads an event needs before it can be built. They all run on the
 * global pool handle, so a caller that is already inside a transaction has to
 * resolve them itself, before opening it.
 */
export interface MetaEventPrerequisites {
  optedOut: boolean
  connection: MetaEventConnection | null
  attribution: MetaAttributionSignals | null
}

export interface EnqueueMetaEventInput {
  tenantId: string
  eventName: MetaEventName
  /** Deterministic. lead:<id>, contact:<id>, schedule:<id>, purchase:<id>. */
  eventId: string
  eventTime: Date
  prospectId: string | null
  /**
   * The patient this event concerns, when there is one. Required for the
   * opt-out check to see the patient's own flag: a Purchase for a walk-in
   * has no prospect at all, and a converted lead can opt out on the patient
   * record long after the prospect row was written.
   */
  patientId?: string | null
  /** Contact data for advanced matching. Hashed inside; pass raw. */
  contact: { phone?: string | null; email?: string | null; fullName?: string | null }
  actionSource: MetaActionSource
  value?: string | null
  eventSourceUrl?: string | null
  /**
   * When present the outbox row joins the caller's transaction and NO HTTP
   * call is made. This prevents an HTTP round trip to graph.facebook.com
   * from holding open a row lock a caller such as `recordPayment` needs
   * for its own transaction.
   */
  tx?: typeof db
  /**
   * Mandatory alongside `tx`: every read below would otherwise check out a
   * second pooled connection while the caller's transaction still holds one.
   */
  prerequisites?: MetaEventPrerequisites
}

export async function resolveMetaEventPrerequisites(
  tenantId: string,
  ref: { prospectId?: string | null; patientId?: string | null },
): Promise<MetaEventPrerequisites> {
  const optedOut = await isMarketingOptedOut(tenantId, ref)
  if (optedOut) return { optedOut: true, connection: null, attribution: null }

  const connection = await getMetaConnection(tenantId)
  if (!connection) return { optedOut: false, connection: null, attribution: null }

  const attribution = ref.prospectId ? await getAttribution(tenantId, ref.prospectId) : null
  return { optedOut: false, connection, attribution }
}

function externalIdSecret(): string | null {
  const secret = process.env.META_EXTERNAL_ID_SECRET
  return secret ? secret : null
}

/**
 * Opaque, stable within a tenant, and uncorrelatable across tenants: a raw
 * prospect uuid would let two clinics that both bought the same lead list
 * compare notes and re-identify a person across their datasets.
 */
function buildExternalId(secret: string, tenantId: string, prospectId: string): string {
  return createHmac('sha256', secret).update(`${tenantId}:${prospectId}`).digest('hex')
}

function buildUserData(
  input: EnqueueMetaEventInput,
  advancedMatchingEnabled: boolean,
  attribution: MetaAttributionSignals | null,
  secret: string | null,
): MetaUserData {
  const userData: MetaUserData = {}

  if (advancedMatchingEnabled) {
    const em = hashEmail(input.contact.email)
    if (em) userData.em = [em]
    const ph = hashPhone(input.contact.phone)
    if (ph) userData.ph = [ph]
    const { first, last } = splitFullName(input.contact.fullName)
    const fn = hashName(first)
    if (fn) userData.fn = [fn]
    const ln = hashName(last)
    if (ln) userData.ln = [ln]
  }

  if (input.prospectId && secret) {
    userData.external_id = [buildExternalId(secret, input.tenantId, input.prospectId)]
  }

  // Sent regardless of action_source: attribution only governs
  // messaging_channel, never which events carry a click id.
  if (attribution?.ctwaClid) userData.ctwa_clid = attribution.ctwaClid
  if (attribution?.fbc) userData.fbc = attribution.fbc
  if (attribution?.fbp) userData.fbp = attribution.fbp
  if (attribution?.clientIp) userData.client_ip_address = attribution.clientIp
  if (attribution?.userAgent) userData.client_user_agent = attribution.userAgent

  return userData
}

export async function enqueueMetaEvent(input: EnqueueMetaEventInput): Promise<void> {
  try {
    const secret = externalIdSecret()

    // Without the secret an attributed event cannot be matched at all. Record
    // the loss as a skipped row instead of building a payload that throws on
    // the way to the outbox and leaves no trace of the event at all.
    if (input.prospectId && !secret) {
      reportSideEffectFailure(
        new Error('META_EXTERNAL_ID_SECRET is unset; attributed Meta events cannot be built'),
        { area: 'meta-capi', step: 'external_id_secret' },
      )
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: null,
          payload: null,
          status: 'skipped',
          skipReason: 'no_external_id_secret',
        },
        input.tx,
      )
      return
    }

    const { optedOut, connection, attribution } =
      input.prerequisites ??
      (await resolveMetaEventPrerequisites(input.tenantId, {
        prospectId: input.prospectId,
        patientId: input.patientId,
      }))

    if (optedOut) {
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: null,
          payload: null,
          status: 'skipped',
          skipReason: 'opted_out',
        },
        input.tx,
      )
      return
    }

    if (!connection) {
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: null,
          payload: null,
          status: 'skipped',
          skipReason: 'no_connection',
        },
        input.tx,
      )
      return
    }

    const userData = buildUserData(input, connection.advancedMatchingEnabled, attribution, secret)

    const isPurchase = input.eventName === 'Purchase'
    const numericValue = isPurchase && input.value ? Number(input.value) : undefined

    const payload: MetaEventPayload = {
      event_name: input.eventName,
      event_time: Math.floor(input.eventTime.getTime() / 1000),
      event_id: input.eventId,
      action_source: input.actionSource,
      ...(input.actionSource === 'business_messaging' ? { messaging_channel: 'whatsapp' as const } : {}),
      ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
      user_data: userData,
      ...(numericValue !== undefined ? { custom_data: { value: numericValue, currency: 'BRL' } } : {}),
    }

    const { inserted, id } = await insertConversionEvent(
      {
        tenantId: input.tenantId,
        prospectId: input.prospectId,
        eventName: input.eventName,
        eventId: input.eventId,
        eventTime: input.eventTime,
        value: isPurchase ? input.value ?? null : null,
        payload,
        status: 'pending',
      },
      input.tx,
    )

    // Duplicate: six installment payments call this six times for one
    // Purchase and it must insert once.
    if (!inserted) return

    // Held inside the caller's transaction: the cron delivers this row
    // within 5 minutes instead of holding an HTTP call under a row lock.
    if (input.tx) return

    const result = await postEvents(
      { datasetId: connection.datasetId, accessToken: connection.accessToken, testEventCode: connection.testEventCode },
      [payload],
    )

    if (result.ok) {
      await markEventSent(input.tenantId, id, result.fbTraceId)
      return
    }

    if (result.kind === 'auth') {
      await markConnectionInvalid(input.tenantId, result.message)
    }
    await markEventFailure(input.tenantId, id, result.kind, result.message)
  } catch (error) {
    // A failed statement on the caller's transaction has already aborted the
    // Postgres block. Swallowing it here would let the caller COMMIT, get a
    // silent ROLLBACK back, and answer 201 for a payment that never landed.
    // Only the standalone path can absorb a failure without losing a write.
    if (input.tx) throw error
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'enqueue_meta_event' })
  }
}

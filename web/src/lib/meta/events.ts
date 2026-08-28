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
}

/**
 * Opaque, stable within a tenant, and uncorrelatable across tenants: a raw
 * prospect uuid would let two clinics that both bought the same lead list
 * compare notes and re-identify a person across their datasets.
 */
function buildExternalId(tenantId: string, prospectId: string): string {
  return createHmac('sha256', process.env.META_EXTERNAL_ID_SECRET!)
    .update(`${tenantId}:${prospectId}`)
    .digest('hex')
}

function buildUserData(
  input: EnqueueMetaEventInput,
  advancedMatchingEnabled: boolean,
  attribution: {
    ctwaClid: string | null
    fbc: string | null
    fbp: string | null
    clientIp: string | null
    userAgent: string | null
  } | null,
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

  if (input.prospectId) {
    userData.external_id = [buildExternalId(input.tenantId, input.prospectId)]
  }

  // ctwa_clid is never hashed (Meta's parameter reference marks it "Do not
  // hash"), and it is sent regardless of action_source: attribution only
  // governs messaging_channel, never which events carry a click id.
  if (attribution?.ctwaClid) userData.ctwa_clid = attribution.ctwaClid
  if (attribution?.fbc) userData.fbc = attribution.fbc
  if (attribution?.fbp) userData.fbp = attribution.fbp
  if (attribution?.clientIp) userData.client_ip_address = attribution.clientIp
  if (attribution?.userAgent) userData.client_user_agent = attribution.userAgent

  return userData
}

export async function enqueueMetaEvent(input: EnqueueMetaEventInput): Promise<void> {
  try {
    const optedOut = await isMarketingOptedOut(input.tenantId, {
      prospectId: input.prospectId,
      patientId: input.patientId,
    })
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

    const connection = await getMetaConnection(input.tenantId)
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

    const attribution = input.prospectId
      ? await getAttribution(input.tenantId, input.prospectId)
      : null

    const userData = buildUserData(input, connection.advancedMatchingEnabled, attribution)

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
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'enqueue_meta_event' })
  }
}

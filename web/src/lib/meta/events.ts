import { createHmac } from 'node:crypto'

import type { db } from '@/db/client'
import { getMetaConnection, markConnectionInvalid } from '@/db/queries/meta-connections'
import {
  claimEventForSending,
  insertConversionEvent,
  markEventFailure,
  markEventSent,
  markEventSkipped,
  releaseEventClaims,
} from '@/db/queries/meta-events'
import { getAttribution } from '@/db/queries/lead-attributions'
import { isMarketingOptedOut } from '@/db/queries/marketing-consent'
import { getPatient } from '@/db/queries/patients'
import { getProspect } from '@/db/queries/prospects'
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

export interface MetaEventContact {
  phone?: string | null
  email?: string | null
  fullName?: string | null
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
  contact: MetaEventContact
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
   * An optimisation, not a requirement: with `tx` and no prerequisites the
   * row is written bare and `sendPendingEvent` resolves everything later.
   * Supplying them lets the payload be built now, without checking out a
   * second pooled connection while the caller's transaction holds one.
   */
  prerequisites?: MetaEventPrerequisites
}

export async function resolveMetaEventPrerequisites(
  tenantId: string,
  ref: { prospectId?: string | null; patientId?: string | null; phone?: string | null },
): Promise<MetaEventPrerequisites> {
  const optedOut = await isMarketingOptedOut(tenantId, {
    patientId: ref.patientId,
    phone: ref.phone,
  })
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

interface BuildPayloadInput {
  tenantId: string
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  prospectId: string | null
  contact: MetaEventContact
  actionSource: MetaActionSource
  value?: string | null
  eventSourceUrl?: string | null
}

function buildUserData(
  input: BuildPayloadInput,
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

function buildEventPayload(
  input: BuildPayloadInput,
  advancedMatchingEnabled: boolean,
  attribution: MetaAttributionSignals | null,
  secret: string | null,
): MetaEventPayload {
  const userData = buildUserData(input, advancedMatchingEnabled, attribution, secret)

  const isPurchase = input.eventName === 'Purchase'
  const numericValue = isPurchase && input.value ? Number(input.value) : undefined

  return {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: input.actionSource,
    ...(input.actionSource === 'business_messaging' ? { messaging_channel: 'whatsapp' as const } : {}),
    ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
    user_data: userData,
    ...(numericValue !== undefined ? { custom_data: { value: numericValue, currency: 'BRL' } } : {}),
  }
}

/**
 * A missing secret skips every attributed event, so reporting per event would
 * bury the alert under thousands of copies of itself. One report per process
 * is enough to notice, and the skipped rows carry the per-event evidence.
 */
let missingSecretReported = false

function reportMissingSecretOnce(): void {
  if (missingSecretReported) return
  missingSecretReported = true
  reportSideEffectFailure(
    new Error('META_EXTERNAL_ID_SECRET is unset; attributed Meta events cannot be built'),
    { area: 'meta-capi', step: 'external_id_secret' },
  )
}

/** The outbox row `sendPendingEvent` delivers. */
export interface PendingMetaEventRow {
  id: string
  tenantId: string
  prospectId: string | null
  patientId: string | null
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  value: string | null
  /** Null on rows written before the column existed. */
  actionSource: MetaActionSource | null
  payload: unknown | null
}

async function loadContact(row: PendingMetaEventRow): Promise<MetaEventContact> {
  if (row.patientId) {
    const patient = await getPatient(row.tenantId, row.patientId)
    if (patient) {
      return { phone: patient.phone, email: patient.email, fullName: patient.fullName }
    }
  }

  if (row.prospectId) {
    const prospect = await getProspect(row.tenantId, row.prospectId)
    if (prospect) return { phone: prospect.phone, email: null, fullName: prospect.name }
  }

  return { phone: null, email: null, fullName: null }
}

async function rebuildPayload(
  row: PendingMetaEventRow,
  connection: MetaEventConnection,
  contact: MetaEventContact,
): Promise<MetaEventPayload | null> {
  const secret = externalIdSecret()

  if (row.prospectId && !secret) {
    reportMissingSecretOnce()
    await markEventSkipped(row.tenantId, row.id, 'no_external_id_secret')
    return null
  }

  const attribution = row.prospectId ? await getAttribution(row.tenantId, row.prospectId) : null

  return buildEventPayload(
    {
      tenantId: row.tenantId,
      eventName: row.eventName,
      eventId: row.eventId,
      eventTime: row.eventTime,
      prospectId: row.prospectId,
      contact,
      // The emitting site's own action source. Guessing it costs the event
      // its attribution: a CTWA lead rebuilt as `system_generated` carries a
      // ctwa_clid Meta will not read.
      actionSource: row.actionSource ?? 'system_generated',
      value: row.value,
    },
    connection.advancedMatchingEnabled,
    attribution,
    secret,
  )
}

/**
 * Delivers one outbox row and records the outcome. The only place an event
 * reaches graph.facebook.com, so the opt-out re-check below is the last gate
 * every event passes, however long the row sat pending.
 *
 * The row must already be claimed: every write here is conditional on it
 * still being `sending`, so an unclaimed row would be delivered and then
 * silently left pending for the next run to deliver again.
 */
export async function sendPendingEvent(row: PendingMetaEventRow): Promise<void> {
  const connection = await getMetaConnection(row.tenantId)
  // Returned to pending on purpose: the cron is what decides when a deferred
  // row has aged past what Meta accepts.
  if (!connection) {
    await releaseEventClaims([row.id])
    return
  }

  const contact = await loadContact(row)

  // Re-checked on every attempt, not just at enqueue time: a patient who
  // opts out while their row waits for a working connection must not have
  // their data sent by the next sweep.
  const optedOut = await isMarketingOptedOut(row.tenantId, {
    patientId: row.patientId,
    phone: contact.phone,
  })
  if (optedOut) {
    await markEventSkipped(row.tenantId, row.id, 'opted_out')
    return
  }

  const payload =
    (row.payload as MetaEventPayload | null) ?? (await rebuildPayload(row, connection, contact))
  if (!payload) return

  const result = await postEvents(
    {
      datasetId: connection.datasetId,
      accessToken: connection.accessToken,
      testEventCode: connection.testEventCode,
    },
    [payload],
  )

  if (result.ok) {
    await markEventSent(row.tenantId, row.id, result.fbTraceId)
    return
  }

  if (result.kind === 'auth') {
    await markConnectionInvalid(row.tenantId, result.message)
  }
  await markEventFailure(row.tenantId, row.id, result.kind, result.message)
}

/**
 * Claims the row before delivering it, for the inline paths that build a row
 * and send it in the same breath. A false return means another sender got
 * there first and this caller owes nothing.
 */
export async function claimAndSendPendingEvent(row: PendingMetaEventRow): Promise<boolean> {
  if (!(await claimEventForSending(row.tenantId, row.id))) return false

  await sendPendingEvent(row)
  return true
}

/** `inserted` is false when the row was already in the outbox before this call. */
export async function enqueueMetaEvent(input: EnqueueMetaEventInput): Promise<{ inserted: boolean }> {
  try {
    // Inside a caller's transaction with nothing pre-resolved there is no read
    // this can safely make, so the row goes in bare and `sendPendingEvent`
    // enriches it.
    if (input.tx && !input.prerequisites) {
      return await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: input.eventName === 'Purchase' ? input.value ?? null : null,
          actionSource: input.actionSource,
          payload: null,
          status: 'pending',
        },
        input.tx,
      )
    }

    const secret = externalIdSecret()

    // Without the secret an attributed event cannot be matched at all. Record
    // the loss as a skipped row instead of building a payload that throws on
    // the way to the outbox and leaves no trace of the event at all.
    if (input.prospectId && !secret) {
      reportMissingSecretOnce()
      return await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: null,
          actionSource: input.actionSource,
          payload: null,
          status: 'skipped',
          skipReason: 'no_external_id_secret',
        },
        input.tx,
      )
    }

    const { optedOut, connection, attribution } =
      input.prerequisites ??
      (await resolveMetaEventPrerequisites(input.tenantId, {
        prospectId: input.prospectId,
        patientId: input.patientId,
        phone: input.contact.phone,
      }))

    if (optedOut) {
      return await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: null,
          actionSource: input.actionSource,
          payload: null,
          status: 'skipped',
          skipReason: 'opted_out',
        },
        input.tx,
      )
    }

    // Pending, not skipped. A clinic between the two OAuth legs sits in
    // `pending_dataset`, which reads here as no connection at all, and a
    // terminal row would both lose the event and satisfy the cron's
    // reconciliation join, so nothing would ever repair it once the dataset
    // is picked. Pending puts the row on the path the cron already has for a
    // tenant with no usable connection: deferred each run, given up only once
    // it ages past the window Meta accepts.
    if (!connection) {
      return await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: input.eventName === 'Purchase' ? input.value ?? null : null,
          actionSource: input.actionSource,
          payload: null,
          status: 'pending',
        },
        input.tx,
      )
    }

    const isPurchase = input.eventName === 'Purchase'
    const value = isPurchase ? input.value ?? null : null
    const payload = buildEventPayload(
      {
        tenantId: input.tenantId,
        eventName: input.eventName,
        eventId: input.eventId,
        eventTime: input.eventTime,
        prospectId: input.prospectId,
        contact: input.contact,
        actionSource: input.actionSource,
        value,
        eventSourceUrl: input.eventSourceUrl,
      },
      connection.advancedMatchingEnabled,
      attribution,
      secret,
    )

    const { inserted, id } = await insertConversionEvent(
      {
        tenantId: input.tenantId,
        prospectId: input.prospectId,
        patientId: input.patientId ?? null,
        eventName: input.eventName,
        eventId: input.eventId,
        eventTime: input.eventTime,
        value,
        actionSource: input.actionSource,
        payload,
        status: 'pending',
      },
      input.tx,
    )

    // Duplicate: six installment payments call this six times for one
    // Purchase and it must insert once.
    if (!inserted) return { inserted: false }

    // Inside the caller's transaction the row is written but never sent: an
    // HTTP call here would hold recordPayment's row lock across a network
    // round trip.
    if (input.tx) return { inserted: true }

    await claimAndSendPendingEvent({
      id,
      tenantId: input.tenantId,
      prospectId: input.prospectId,
      patientId: input.patientId ?? null,
      eventName: input.eventName,
      eventId: input.eventId,
      eventTime: input.eventTime,
      value,
      actionSource: input.actionSource,
      payload,
    })

    return { inserted: true }
  } catch (error) {
    // Postgres has already aborted the caller's transaction, so only the
    // caller can decide what the failure costs.
    if (input.tx) throw error
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'enqueue_meta_event' })
    return { inserted: false }
  }
}

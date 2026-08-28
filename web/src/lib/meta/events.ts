import { createHmac } from 'node:crypto'

import type { db } from '@/db/client'
import { getMetaConnection, markConnectionInvalid } from '@/db/queries/meta-connections'
import {
  insertConversionEvent,
  markEventFailure,
  markEventSent,
  markEventSkipped,
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
      // A row reaches here with no payload only when it was written bare
      // inside a caller's transaction, and the sole such emission site is
      // the Purchase on a payment.
      actionSource: 'system_generated',
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
 */
export async function sendPendingEvent(row: {
  id: string
  tenantId: string
  prospectId: string | null
  patientId: string | null
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  value: string | null
  payload: unknown | null
}): Promise<void> {
  const connection = await getMetaConnection(row.tenantId)
  // Left pending on purpose: a re-pasted token is minutes away and the cron
  // is what decides when a deferred row has aged past what Meta accepts.
  if (!connection) return

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

export async function enqueueMetaEvent(input: EnqueueMetaEventInput): Promise<void> {
  try {
    // Inside a caller's transaction with nothing pre-resolved there is no read
    // this can safely make, so the row goes in bare and `sendPendingEvent`
    // enriches it. Anything else would let a failed lookup discard a Purchase
    // the payment already committed, and Purchase is not reconciled.
    if (input.tx && !input.prerequisites) {
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime,
          value: input.eventName === 'Purchase' ? input.value ?? null : null,
          payload: null,
          status: 'pending',
        },
        input.tx,
      )
      return
    }

    const secret = externalIdSecret()

    // Without the secret an attributed event cannot be matched at all. Record
    // the loss as a skipped row instead of building a payload that throws on
    // the way to the outbox and leaves no trace of the event at all.
    if (input.prospectId && !secret) {
      reportMissingSecretOnce()
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
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
        phone: input.contact.phone,
      }))

    if (optedOut) {
      await insertConversionEvent(
        {
          tenantId: input.tenantId,
          prospectId: input.prospectId,
          patientId: input.patientId ?? null,
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
          patientId: input.patientId ?? null,
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

    await sendPendingEvent({
      id,
      tenantId: input.tenantId,
      prospectId: input.prospectId,
      patientId: input.patientId ?? null,
      eventName: input.eventName,
      eventId: input.eventId,
      eventTime: input.eventTime,
      value,
      payload,
    })
  } catch (error) {
    // A failed statement on the caller's transaction has already aborted the
    // Postgres block. Swallowing it here would let the caller COMMIT, get a
    // silent ROLLBACK back, and answer 201 for a payment that never landed.
    // Only the standalone path can absorb a failure without losing a write.
    if (input.tx) throw error
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'enqueue_meta_event' })
  }
}

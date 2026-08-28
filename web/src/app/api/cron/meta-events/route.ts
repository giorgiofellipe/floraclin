import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { metaConnections, metaConversionEvents, prospectActivities, prospects } from '@/db/schema'
import {
  countEventOutcomes,
  hasScheduleForProspect,
  markEventSkipped,
  selectPendingEvents,
  type PendingEvent,
} from '@/db/queries/meta-events'
import { getMetaConnection, type MetaConnection } from '@/db/queries/meta-connections'
import { enqueueMetaEvent, sendPendingEvent } from '@/lib/meta/events'
import { backfillAdMetadata } from '@/lib/meta/ad-metadata'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'

// Schedule mirrors `vercel.json`; see withCronMonitor for the rest.
const MONITOR_SLUG = 'meta-events'
export const MONITOR_SCHEDULE = '0 4 * * *'

const CLAIM_LIMIT = 500
const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const RECONCILE_LIMIT = 200
const RECONCILE_CONCURRENCY = 10
const TENANT_FAILURE_ALERT_THRESHOLD = 10

// Meta rejects events whose event_time is more than 7 days old, so a row
// that waited this long for a working connection can never be delivered.
// The sweep runs daily, so a parked row gets about six attempts inside it.
const NO_CONNECTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

interface RetrySweepResult {
  claimed: number
  sent: number
  deferredNoConnection: number
  skippedNoConnection: number
  failed: number
}

/**
 * A tenant with no usable connection keeps its rows `pending`: a disabled
 * connection or a revoked token is fixed by a clinic on its own schedule,
 * over hours or days, and a terminal status here loses events the clinic
 * never agreed to lose before that fix lands. Rows are only given up once
 * they age past what Meta still accepts.
 */
async function deferOrExpire(
  tenantId: string,
  events: PendingEvent[],
  now: Date,
): Promise<{ deferred: number; expired: number }> {
  let deferred = 0
  let expired = 0

  for (const event of events) {
    if (now.getTime() - event.createdAt.getTime() > NO_CONNECTION_GRACE_MS) {
      await markEventSkipped(tenantId, event.id, 'no_connection')
      expired += 1
      continue
    }
    deferred += 1
  }

  return { deferred, expired }
}

/**
 * Replays pending outbox rows through the same sender the inline emission
 * path uses, so a retry re-reads the opt-out flag and rebuilds a payload the
 * original attempt never wrote. A tenant with more than
 * TENANT_FAILURE_ALERT_THRESHOLD rows moving to `failed` in this run gets one
 * Sentry warning, tagged with the tenant id.
 */
async function runRetrySweep(): Promise<RetrySweepResult> {
  const pending = await selectPendingEvents(CLAIM_LIMIT)
  const now = new Date()

  const byTenant = new Map<string, PendingEvent[]>()
  for (const event of pending) {
    const bucket = byTenant.get(event.tenantId) ?? []
    bucket.push(event)
    byTenant.set(event.tenantId, bucket)
  }

  let sent = 0
  let deferredNoConnection = 0
  let skippedNoConnection = 0
  let failed = 0
  const failedByTenant = new Map<string, number>()

  for (const [tenantId, events] of byTenant) {
    const connection = await getMetaConnection(tenantId)
    // `invalid_token` is included on purpose: posting again would only earn
    // another rejection, and the rows must survive until the token is fixed.
    if (!connection || connection.status === 'invalid_token') {
      const outcome = await deferOrExpire(tenantId, events, now)
      deferredNoConnection += outcome.deferred
      skippedNoConnection += outcome.expired
      continue
    }

    const attempted: string[] = []
    for (const event of events) {
      await sendPendingEvent(event)
      attempted.push(event.id)

      // sendPendingEvent flags a dead token on the connection itself. Stop
      // instead of spending a round trip per remaining row on the same
      // rejection.
      const current = await getMetaConnection(tenantId)
      if (!current || current.status === 'invalid_token') break
    }

    const outcome = await countEventOutcomes(tenantId, attempted)
    sent += outcome.sent
    failed += outcome.failed
    if (outcome.failed > 0) failedByTenant.set(tenantId, outcome.failed)
  }

  for (const [tenantId, count] of failedByTenant) {
    if (count > TENANT_FAILURE_ALERT_THRESHOLD) {
      Sentry.captureMessage('meta-events cron: tenant failure rate exceeded threshold', {
        level: 'warning',
        tags: { tenantId },
        extra: { failedCount: count },
      })
    }
  }

  return { claimed: pending.length, sent, deferredNoConnection, skippedNoConnection, failed }
}

interface AdMetadataBackfillResult {
  resolved: number
}

/**
 * Every tenant whose connection can read the Marketing API, not only those
 * the retry sweep happened to touch: in steady state nothing is pending, and
 * a backfill driven off retry traffic would never run at all.
 */
async function listBackfillConnections(): Promise<MetaConnection[]> {
  return db
    .select()
    .from(metaConnections)
    .where(and(eq(metaConnections.connectionType, 'oauth'), eq(metaConnections.status, 'active')))
}

/**
 * Enriches lead_attributions with campaign/adset ids so the marketing report
 * can group by campaign instead of falling back to ad id.
 */
async function runAdMetadataBackfill(): Promise<AdMetadataBackfillResult> {
  let resolved = 0
  for (const connection of await listBackfillConnections()) {
    const outcome = await backfillAdMetadata(connection.tenantId, connection)
    resolved += outcome.resolved
  }
  return { resolved }
}

interface ReconciledCandidate {
  tenantId: string
  prospectId: string
  createdAt: Date
  phone: string
  name: string | null
  convertedPatientId: string | null
}

/**
 * `meta_connections.created_at` is the per-tenant floor: a clinic that
 * connects today must not have last week's leads fired as backdated
 * conversions, because none of them was ad-attributed at the time. The inner
 * join also keeps unconnected tenants out of the sweep entirely.
 */
async function findMissingLeadActivities(windowStart: Date): Promise<ReconciledCandidate[]> {
  return db
    .select({
      tenantId: prospectActivities.tenantId,
      prospectId: prospectActivities.prospectId,
      createdAt: prospectActivities.createdAt,
      phone: prospects.phone,
      name: prospects.name,
      convertedPatientId: prospects.convertedPatientId,
    })
    .from(prospectActivities)
    .innerJoin(
      prospects,
      and(eq(prospects.id, prospectActivities.prospectId), eq(prospects.tenantId, prospectActivities.tenantId)),
    )
    .innerJoin(metaConnections, eq(metaConnections.tenantId, prospectActivities.tenantId))
    .leftJoin(
      metaConversionEvents,
      and(
        eq(metaConversionEvents.tenantId, prospectActivities.tenantId),
        eq(metaConversionEvents.eventId, sql`'lead:' || ${prospectActivities.prospectId}::text`),
      ),
    )
    .where(
      and(
        eq(prospectActivities.action, 'created'),
        gte(prospectActivities.createdAt, windowStart),
        gte(prospectActivities.createdAt, metaConnections.createdAt),
        isNull(metaConversionEvents.id),
      ),
    )
    .limit(RECONCILE_LIMIT)
}

async function findMissingStageActivities(
  windowStart: Date,
  toStage: 'contatado' | 'agendado',
  eventPrefix: 'contact' | 'schedule',
): Promise<ReconciledCandidate[]> {
  return db
    .select({
      tenantId: prospectActivities.tenantId,
      prospectId: prospectActivities.prospectId,
      createdAt: prospectActivities.createdAt,
      phone: prospects.phone,
      name: prospects.name,
      convertedPatientId: prospects.convertedPatientId,
    })
    .from(prospectActivities)
    .innerJoin(
      prospects,
      and(eq(prospects.id, prospectActivities.prospectId), eq(prospects.tenantId, prospectActivities.tenantId)),
    )
    .innerJoin(metaConnections, eq(metaConnections.tenantId, prospectActivities.tenantId))
    .leftJoin(
      metaConversionEvents,
      and(
        eq(metaConversionEvents.tenantId, prospectActivities.tenantId),
        eq(metaConversionEvents.eventId, sql`${eventPrefix + ':'} || ${prospectActivities.prospectId}::text`),
      ),
    )
    .where(
      and(
        eq(prospectActivities.action, 'stage_changed'),
        sql`${prospectActivities.details}->>'to' = ${toStage}`,
        gte(prospectActivities.createdAt, windowStart),
        gte(prospectActivities.createdAt, metaConnections.createdAt),
        isNull(metaConversionEvents.id),
      ),
    )
    .limit(RECONCILE_LIMIT)
}

async function enqueue(
  row: ReconciledCandidate,
  eventName: 'Lead' | 'Contact' | 'Schedule',
  eventId: string,
): Promise<void> {
  await enqueueMetaEvent({
    tenantId: row.tenantId,
    eventName,
    eventId,
    eventTime: row.createdAt,
    prospectId: row.prospectId,
    // The opt-out flag lives on the patient, so a reconciled event without
    // this is delivered for a patient who ticked the box.
    patientId: row.convertedPatientId,
    contact: { phone: row.phone, fullName: row.name },
    actionSource: 'system_generated',
  })
}

/**
 * Each enqueue is its own Conversions API round trip, so a serial loop over
 * a full window burns the function timeout long before the ad metadata
 * backfill at the end of the run gets to start.
 */
async function reconcileBatched(
  rows: ReconciledCandidate[],
  run: (row: ReconciledCandidate) => Promise<void>,
): Promise<void> {
  for (const group of chunk(rows, RECONCILE_CONCURRENCY)) {
    await Promise.all(group.map(run))
  }
}

/**
 * The left join in the finder only rules out a `schedule:<prospectId>` row. A
 * real appointment can already have produced a Schedule under the
 * appointment's own event id, which this check catches instead.
 */
async function dropAlreadyScheduled(rows: ReconciledCandidate[]): Promise<ReconciledCandidate[]> {
  const keep: ReconciledCandidate[] = []
  for (const group of chunk(rows, RECONCILE_CONCURRENCY)) {
    const existing = await Promise.all(
      group.map((row) => hasScheduleForProspect(row.tenantId, row.prospectId)),
    )
    group.forEach((row, index) => {
      if (!existing[index]) keep.push(row)
    })
  }
  return keep
}

interface ReconciliationResult {
  skipped: boolean
  reconciled: number
}

/**
 * The later of `META_EVENTS_START_AT` and 7 days ago, or null when the env
 * value is not a full ISO timestamp. Using `now()` alone would file a
 * reconciled event's `eventTime` outside the click id window the original
 * event was inside; using `META_EVENTS_START_AT` alone would let the window
 * grow without bound as the deploy ages. This is only the global floor: each
 * tenant's own connection date narrows it further, in the finders above.
 */
export function computeReconciliationWindowStart(startAtRaw: string, now: Date): Date | null {
  // A bare YYYY-MM-DD or a timestamp with no offset resolves against the host
  // clock, which is UTC on Vercel and three hours off the BR day it names.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(startAtRaw)) return null

  const startAt = new Date(startAtRaw)
  if (Number.isNaN(startAt.getTime())) return null

  const sevenDaysAgo = new Date(now.getTime() - RECONCILE_WINDOW_MS)
  return startAt > sevenDaysAgo ? startAt : sevenDaysAgo
}

/**
 * Repairs a crash between a domain write and its outbox insert. Driven
 * entirely off `prospect_activities`, never the prospect's current stage: a
 * lead that went straight `novo` -> `agendado` never had a Contact, and
 * reconciling from current stage would invent one. `Purchase` is not
 * reconciled here: its outbox insert is atomic with the payment transaction,
 * and the payment itself sends the row once that transaction commits, so only
 * a failed send leaves one for the retry sweep above.
 */
async function runReconciliation(): Promise<ReconciliationResult> {
  const startAtRaw = process.env.META_EVENTS_START_AT
  if (!startAtRaw) {
    // Without this gate, the first run ever would find every prospect this
    // tenant has touched, none of which has an outbox row, and fire a
    // backfill of invented conversions at Meta.
    console.log('[cron] meta-events reconciliation skipped: META_EVENTS_START_AT is not set')
    return { skipped: true, reconciled: 0 }
  }

  const windowStart = computeReconciliationWindowStart(startAtRaw, new Date())
  if (!windowStart) {
    // Falling back to the 7-day window here would quietly widen the gate the
    // env var exists to hold shut.
    Sentry.captureMessage('meta-events cron: META_EVENTS_START_AT is not a full ISO timestamp', {
      level: 'warning',
      extra: { value: startAtRaw },
    })
    return { skipped: true, reconciled: 0 }
  }

  const missingLeads = await findMissingLeadActivities(windowStart)
  await reconcileBatched(missingLeads, (row) => enqueue(row, 'Lead', `lead:${row.prospectId}`))

  const missingContacts = await findMissingStageActivities(windowStart, 'contatado', 'contact')
  await reconcileBatched(missingContacts, (row) => enqueue(row, 'Contact', `contact:${row.prospectId}`))

  const missingSchedules = await dropAlreadyScheduled(
    await findMissingStageActivities(windowStart, 'agendado', 'schedule'),
  )
  await reconcileBatched(missingSchedules, (row) => enqueue(row, 'Schedule', `schedule:${row.prospectId}`))

  return {
    skipped: false,
    reconciled: missingLeads.length + missingContacts.length + missingSchedules.length,
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronMonitor(
      MONITOR_SLUG,
      MONITOR_SCHEDULE,
      async () => {
        const retrySweep = await runRetrySweep()
        const reconciliation = await runReconciliation()
        const adMetadataBackfill = await runAdMetadataBackfill()
        return { retrySweep, reconciliation, adMetadataBackfill }
      },
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}

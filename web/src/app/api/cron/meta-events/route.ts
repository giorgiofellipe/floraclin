import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { metaConnections, metaConversionEvents, prospectActivities, prospects } from '@/db/schema'
import {
  claimPendingEvents,
  hasScheduleForProspect,
  markEventFailure,
  markEventSent,
  markEventSkipped,
  type PendingEvent,
} from '@/db/queries/meta-events'
import {
  getMetaConnection,
  markConnectionInvalid,
  type MetaConnection,
} from '@/db/queries/meta-connections'
import { postEvents } from '@/lib/meta/capi-client'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { backfillAdMetadata } from '@/lib/meta/ad-metadata'
import type { MetaEventPayload } from '@/lib/meta/types'
import { handleApiError } from '@/lib/api-error'
import { cronMonitorConfig } from '@/lib/observability'

// Schedule mirrors `vercel.json`; see cronMonitorConfig for the rest.
const MONITOR_SLUG = 'meta-events'
const MONITOR_CONFIG = cronMonitorConfig('*/5 * * * *')

const CLAIM_LIMIT = 500
const POST_BATCH_SIZE = 1000
const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const RECONCILE_LIMIT = 200
const RECONCILE_CONCURRENCY = 10

// Meta rejects events whose event_time is more than 7 days old, so a row
// that waited this long for a working connection can never be delivered.
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

interface RetrySweepOutcome {
  result: RetrySweepResult
  // Connections already resolved this run, reused by the ad metadata
  // backfill below instead of re-querying meta_connections per tenant.
  connections: Map<string, MetaConnection>
}

/**
 * A tenant with no usable connection keeps its rows `pending`: a disabled
 * connection, a revoked token and a re-paste are all minutes apart, and a
 * terminal status here loses events the clinic never agreed to lose. Rows
 * are only given up once they age past what Meta still accepts.
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
 * Claims pending outbox rows, resolves each tenant's connection once, and
 * replays them through the Conversions API in batches of up to 1000 (Meta's
 * per-request event cap). A tenant with more than 10 rows moving to `failed`
 * in this run gets one Sentry warning, tagged with the tenant id.
 */
async function runRetrySweep(): Promise<RetrySweepOutcome> {
  const claimed = await claimPendingEvents(CLAIM_LIMIT)
  const now = new Date()

  const byTenant = new Map<string, PendingEvent[]>()
  for (const event of claimed) {
    const bucket = byTenant.get(event.tenantId) ?? []
    bucket.push(event)
    byTenant.set(event.tenantId, bucket)
  }

  let sent = 0
  let deferredNoConnection = 0
  let skippedNoConnection = 0
  let failed = 0
  const failedByTenant = new Map<string, number>()
  const connections = new Map<string, MetaConnection>()

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
    connections.set(tenantId, connection)

    for (const batch of chunk(events, POST_BATCH_SIZE)) {
      const result = await postEvents(
        { datasetId: connection.datasetId, accessToken: connection.accessToken, testEventCode: connection.testEventCode },
        batch.map((event) => event.payload as MetaEventPayload),
      )

      if (result.ok) {
        for (const event of batch) {
          await markEventSent(tenantId, event.id, result.fbTraceId)
        }
        sent += batch.length
        continue
      }

      for (const event of batch) {
        const status = await markEventFailure(tenantId, event.id, result.kind, result.message)
        if (status === 'failed') {
          failed += 1
          failedByTenant.set(tenantId, (failedByTenant.get(tenantId) ?? 0) + 1)
        }
      }

      // A dead token invalidates every remaining event for this tenant too;
      // stop instead of burning the rest of the batch budget on it.
      if (result.kind === 'auth') {
        await markConnectionInvalid(tenantId, result.message)
        break
      }
    }
  }

  for (const [tenantId, count] of failedByTenant) {
    if (count > 10) {
      Sentry.captureMessage('meta-events cron: tenant failure rate exceeded threshold', {
        level: 'warning',
        tags: { tenantId },
        extra: { failedCount: count },
      })
    }
  }

  return {
    result: { claimed: claimed.length, sent, deferredNoConnection, skippedNoConnection, failed },
    connections,
  }
}

interface AdMetadataBackfillResult {
  resolved: number
}

/**
 * Enriches lead_attributions with campaign/adset ids for tenants already
 * touched by this run's retry sweep, reusing the connection it resolved
 * rather than a separate tenant scan. backfillAdMetadata itself skips
 * anything that isn't an OAuth connection.
 */
async function runAdMetadataBackfill(
  connections: Map<string, MetaConnection>,
): Promise<AdMetadataBackfillResult> {
  let resolved = 0
  for (const [tenantId, connection] of connections) {
    const outcome = await backfillAdMetadata(tenantId, connection)
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
): Promise<boolean> {
  await enqueueMetaEvent({
    tenantId: row.tenantId,
    eventName,
    eventId,
    eventTime: row.createdAt,
    prospectId: row.prospectId,
    contact: { phone: row.phone, fullName: row.name },
    actionSource: 'system_generated',
  })
  return true
}

/**
 * Each enqueue is its own Conversions API round trip, so a serial loop over
 * a full window burns the function timeout long before the ad metadata
 * backfill at the end of the run gets to start.
 */
async function reconcileBatched(
  rows: ReconciledCandidate[],
  run: (row: ReconciledCandidate) => Promise<boolean>,
): Promise<number> {
  let reconciled = 0
  for (const group of chunk(rows, RECONCILE_CONCURRENCY)) {
    const outcomes = await Promise.all(group.map(run))
    reconciled += outcomes.filter(Boolean).length
  }
  return reconciled
}

interface ReconciliationResult {
  skipped: boolean
  reconciled: number
}

/**
 * The later of `META_EVENTS_START_AT` and 7 days ago. Using `now()` alone
 * would file a reconciled event's `eventTime` outside the click id window
 * the original event was inside; using `META_EVENTS_START_AT` alone would
 * let the window grow without bound as the deploy ages. This is only the
 * global floor: each tenant's own connection date narrows it further, in
 * the finders above.
 */
export function computeReconciliationWindowStart(startAtRaw: string, now: Date): Date {
  const startAt = new Date(startAtRaw)
  const sevenDaysAgo = new Date(now.getTime() - RECONCILE_WINDOW_MS)
  return startAt > sevenDaysAgo ? startAt : sevenDaysAgo
}

/**
 * Repairs a crash between a domain write and its outbox insert. Driven
 * entirely off `prospect_activities`, never the prospect's current stage: a
 * lead that went straight `novo` -> `agendado` never had a Contact, and
 * reconciling from current stage would invent one. `Purchase` is not
 * reconciled here; its outbox insert is already atomic with the payment
 * transaction.
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

  const missingLeads = await findMissingLeadActivities(windowStart)
  const leads = await reconcileBatched(missingLeads, (row) =>
    enqueue(row, 'Lead', `lead:${row.prospectId}`),
  )

  const missingContacts = await findMissingStageActivities(windowStart, 'contatado', 'contact')
  const contacts = await reconcileBatched(missingContacts, (row) =>
    enqueue(row, 'Contact', `contact:${row.prospectId}`),
  )

  const missingSchedules = await findMissingStageActivities(windowStart, 'agendado', 'schedule')
  const schedules = await reconcileBatched(missingSchedules, async (row) => {
    // The left join only rules out a `schedule:<prospectId>` row. A real
    // appointment can already have produced a Schedule under the
    // appointment's own event id, which this check catches instead.
    if (await hasScheduleForProspect(row.tenantId, row.prospectId)) return false
    return enqueue(row, 'Schedule', `schedule:${row.prospectId}`)
  })

  return { skipped: false, reconciled: leads + contacts + schedules }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await Sentry.withMonitor(
      MONITOR_SLUG,
      async () => {
        const { result: retrySweep, connections } = await runRetrySweep()
        const reconciliation = await runReconciliation()
        const adMetadataBackfill = await runAdMetadataBackfill(connections)
        return { retrySweep, reconciliation, adMetadataBackfill }
      },
      MONITOR_CONFIG,
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}

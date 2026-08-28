import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { metaConversionEvents, prospectActivities, prospects } from '@/db/schema'
import {
  claimPendingEvents,
  hasScheduleForProspect,
  markEventFailure,
  markEventSent,
  markEventSkipped,
  type PendingEvent,
} from '@/db/queries/meta-events'
import { getMetaConnection, markConnectionInvalid } from '@/db/queries/meta-connections'
import { postEvents } from '@/lib/meta/capi-client'
import { enqueueMetaEvent } from '@/lib/meta/events'
import type { MetaEventPayload } from '@/lib/meta/types'
import { handleApiError } from '@/lib/api-error'
import { cronMonitorConfig } from '@/lib/observability'

// Schedule mirrors `vercel.json`; see cronMonitorConfig for the rest.
const MONITOR_SLUG = 'meta-events'
const MONITOR_CONFIG = cronMonitorConfig('*/5 * * * *')

const CLAIM_LIMIT = 500
const POST_BATCH_SIZE = 1000
const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Mirrors MAX_ATTEMPTS in meta-events.ts. markEventFailure re-reads the
// attempts column from the row claimPendingEvents already incremented, so a
// transient failure here reaches the cutoff at `event.attempts + 1`. Only
// used to decide whether a row counts toward the Sentry failure-rate alert;
// the actual status transition happens inside markEventFailure.
const MAX_ATTEMPTS = 8

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

function willBeFailed(kind: 'transient' | 'invalid' | 'auth', attemptsAfterClaim: number): boolean {
  if (kind !== 'transient') return true
  return attemptsAfterClaim + 1 >= MAX_ATTEMPTS
}

interface RetrySweepResult {
  claimed: number
  sent: number
  skippedNoConnection: number
  failed: number
}

/**
 * Claims pending outbox rows, resolves each tenant's connection once, and
 * replays them through the Conversions API in batches of up to 1000 (Meta's
 * per-request event cap). A tenant with more than 10 rows moving to `failed`
 * in this run gets one Sentry warning, tagged with the tenant id.
 */
async function runRetrySweep(): Promise<RetrySweepResult> {
  const claimed = await claimPendingEvents(CLAIM_LIMIT)

  const byTenant = new Map<string, PendingEvent[]>()
  for (const event of claimed) {
    const bucket = byTenant.get(event.tenantId) ?? []
    bucket.push(event)
    byTenant.set(event.tenantId, bucket)
  }

  let sent = 0
  let skippedNoConnection = 0
  let failed = 0
  const failedByTenant = new Map<string, number>()

  for (const [tenantId, events] of byTenant) {
    const connection = await getMetaConnection(tenantId)
    if (!connection) {
      for (const event of events) {
        await markEventSkipped(tenantId, event.id, 'no_connection')
      }
      skippedNoConnection += events.length
      continue
    }

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
        await markEventFailure(tenantId, event.id, result.kind, result.message)
        if (willBeFailed(result.kind, event.attempts)) {
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

  return { claimed: claimed.length, sent, skippedNoConnection, failed }
}

interface ReconciledCandidate {
  tenantId: string
  prospectId: string
  createdAt: Date
  phone: string
  name: string | null
}

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
        isNull(metaConversionEvents.id),
      ),
    )
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
        isNull(metaConversionEvents.id),
      ),
    )
}

interface ReconciliationResult {
  skipped: boolean
  reconciled: number
}

/**
 * The later of `META_EVENTS_START_AT` and 7 days ago. Using `now()` alone
 * would file a reconciled event's `eventTime` outside the click id window
 * the original event was inside; using `META_EVENTS_START_AT` alone would
 * let the window grow without bound as the deploy ages.
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

  let reconciled = 0

  const missingLeads = await findMissingLeadActivities(windowStart)
  for (const row of missingLeads) {
    await enqueueMetaEvent({
      tenantId: row.tenantId,
      eventName: 'Lead',
      eventId: `lead:${row.prospectId}`,
      eventTime: row.createdAt,
      prospectId: row.prospectId,
      contact: { phone: row.phone, fullName: row.name },
      actionSource: 'system_generated',
    })
    reconciled += 1
  }

  const missingContacts = await findMissingStageActivities(windowStart, 'contatado', 'contact')
  for (const row of missingContacts) {
    await enqueueMetaEvent({
      tenantId: row.tenantId,
      eventName: 'Contact',
      eventId: `contact:${row.prospectId}`,
      eventTime: row.createdAt,
      prospectId: row.prospectId,
      contact: { phone: row.phone, fullName: row.name },
      actionSource: 'system_generated',
    })
    reconciled += 1
  }

  const missingSchedules = await findMissingStageActivities(windowStart, 'agendado', 'schedule')
  for (const row of missingSchedules) {
    // The left join only rules out a `schedule:<prospectId>` row. A real
    // appointment can already have produced a Schedule under the
    // appointment's own event id, which this check catches instead.
    const alreadyScheduled = await hasScheduleForProspect(row.tenantId, row.prospectId)
    if (alreadyScheduled) continue

    await enqueueMetaEvent({
      tenantId: row.tenantId,
      eventName: 'Schedule',
      eventId: `schedule:${row.prospectId}`,
      eventTime: row.createdAt,
      prospectId: row.prospectId,
      contact: { phone: row.phone, fullName: row.name },
      actionSource: 'system_generated',
    })
    reconciled += 1
  }

  return { skipped: false, reconciled }
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
        const retrySweep = await runRetrySweep()
        const reconciliation = await runReconciliation()
        return { retrySweep, reconciliation }
      },
      MONITOR_CONFIG,
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}

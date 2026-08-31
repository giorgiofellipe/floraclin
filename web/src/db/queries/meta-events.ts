import { db } from '@/db/client'
import { metaConversionEvents, prospects } from '@/db/schema'
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { MetaActionSource, MetaEventName } from '@/lib/meta/types'

/** Meta stops accepting an event this long after its event_time. */
export const META_EVENT_WINDOW_DAYS = 7

// The sweep runs once a day and Meta stops accepting an event seven days
// after its event_time, so a row must run out of attempts before it runs out
// of window.
export const MAX_ATTEMPTS = 6
const CLAIM_MIN_AGE_MS = 60_000

/**
 * A sender that crashes between claiming a row and writing its outcome leaves
 * the row `sending` with nobody to finish it. Anything still `sending` this
 * long after its claim is assumed dead and goes back to `pending`. It has to
 * outlast the longest a single send can take, which is the Conversions API
 * timeout plus the reads around it.
 */
export const SENDING_CLAIM_TIMEOUT_MS = 15 * 60 * 1000

/** What the busiest clinic on the platform writes in a single day. */
const PEAK_EVENTS_PER_TENANT_PER_DAY = 120

/**
 * Per tenant, per run. The claim is global and ordered oldest first, so
 * without a cap one clinic with a revoked token owns every slot in the run.
 *
 * The cap has to be a whole window's backlog rather than a round number: an
 * outage that lasts six days leaves its oldest rows one day of window and one
 * sweep to use it, so a run that cannot take the entire backlog at once
 * watches the rest expire. The old cap of 50 against a daily cron drained 350
 * rows a week and lost everything past that.
 */
export const MAX_EVENTS_PER_TENANT = PEAK_EVENTS_PER_TENANT_PER_DAY * META_EVENT_WINDOW_DAYS

export interface InsertConversionEventInput {
  tenantId: string
  prospectId: string | null
  patientId?: string | null
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  value?: string | null
  actionSource?: MetaActionSource | null
  payload: unknown
  status: 'pending' | 'skipped'
  skipReason?: string | null
}

export interface PendingEvent {
  id: string
  tenantId: string
  prospectId: string | null
  /**
   * The stored `patient_id` when the emitting site knew one, otherwise derived
   * from `prospects.converted_patient_id`: the opt-out flag lives on the
   * patient, and a lead can convert after its outbox row was written.
   */
  patientId: string | null
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  value: string | null
  actionSource: MetaActionSource | null
  payload: unknown
  createdAt: Date
}

export type EventFailureStatus = 'pending' | 'failed'

export interface RecentEvent {
  id: string
  prospectId: string | null
  eventName: string
  eventId: string
  status: string
  skipReason: string | null
  attempts: number
  lastError: string | null
  fbTraceId: string | null
  sentAt: Date | null
  createdAt: Date
}

export async function insertConversionEvent(
  input: InsertConversionEventInput,
  tx: typeof db = db,
): Promise<{ inserted: boolean; id: string }> {
  const [inserted] = await tx
    .insert(metaConversionEvents)
    .values({
      tenantId: input.tenantId,
      prospectId: input.prospectId,
      patientId: input.patientId ?? null,
      eventName: input.eventName,
      eventId: input.eventId,
      eventTime: input.eventTime,
      value: input.value ?? null,
      actionSource: input.actionSource ?? null,
      payload: input.payload,
      status: input.status,
      skipReason: input.skipReason ?? null,
    })
    .onConflictDoNothing({ target: [metaConversionEvents.tenantId, metaConversionEvents.eventId] })
    .returning({ id: metaConversionEvents.id })

  if (inserted) {
    return { inserted: true, id: inserted.id }
  }

  // onConflictDoNothing().returning() yields nothing on conflict, so the
  // caller still needs the id of the row that already exists.
  const [existing] = await tx
    .select({ id: metaConversionEvents.id })
    .from(metaConversionEvents)
    .where(and(eq(metaConversionEvents.tenantId, input.tenantId), eq(metaConversionEvents.eventId, input.eventId)))
    .limit(1)

  if (!existing) {
    throw new Error('insertConversionEvent: conflicted but no existing row found')
  }

  return { inserted: false, id: existing.id }
}

/**
 * Every terminal write is scoped to a row this sender still owns. Without the
 * status predicate a slow sender that lost its claim to the reaper overwrites
 * whatever the new owner already recorded, and an accepted event flips back
 * to `pending` and is sent again.
 */
function claimedRow(tenantId: string, id: string) {
  return and(
    eq(metaConversionEvents.tenantId, tenantId),
    eq(metaConversionEvents.id, id),
    eq(metaConversionEvents.status, 'sending'),
  )
}

export async function markEventSent(tenantId: string, id: string, fbTraceId?: string): Promise<void> {
  await db
    .update(metaConversionEvents)
    .set({ status: 'sent', sentAt: new Date(), fbTraceId: fbTraceId ?? null, claimedAt: null })
    .where(claimedRow(tenantId, id))
}

/**
 * The single place that decides whether a failed row retries. `invalid` is
 * terminal because Meta rejected the payload itself and a retry resends the
 * same bytes; `auth` stays pending and spends no budget because a re-pasted
 * token is exactly the fix. Only a transient failure consumes an attempt,
 * so a row parked while its tenant has no working connection keeps its full
 * budget.
 */
export async function markEventFailure(
  tenantId: string,
  id: string,
  kind: 'transient' | 'invalid' | 'auth',
  message: string,
): Promise<EventFailureStatus> {
  const scope = claimedRow(tenantId, id)

  if (kind !== 'transient') {
    const status: EventFailureStatus = kind === 'invalid' ? 'failed' : 'pending'
    await db
      .update(metaConversionEvents)
      .set({ status, lastError: message, claimedAt: null })
      .where(scope)
    return status
  }

  const [current] = await db
    .select({ attempts: metaConversionEvents.attempts })
    .from(metaConversionEvents)
    .where(scope)
    .limit(1)

  const attempts = (current?.attempts ?? 0) + 1
  const status: EventFailureStatus = attempts < MAX_ATTEMPTS ? 'pending' : 'failed'

  await db
    .update(metaConversionEvents)
    .set({ attempts, status, lastError: message, claimedAt: null })
    .where(scope)

  return status
}

export async function markEventSkipped(tenantId: string, id: string, reason: string): Promise<void> {
  await db
    .update(metaConversionEvents)
    .set({ status: 'skipped', skipReason: reason, claimedAt: null })
    .where(claimedRow(tenantId, id))
}

/**
 * Takes ownership of the rows it returns. The `sending` status is the claim
 * itself: it survives the statement that set it, unlike the row lock this
 * used to rely on, so a second sender running at the same time sees the rows
 * as taken and gets none of them.
 *
 * One statement, so there is no window where a row is chosen but not yet
 * claimed. `status = 'pending'` is repeated on the UPDATE and not left to the
 * subquery alone: Postgres re-checks the outer predicate against the row a
 * concurrent writer just committed, and that is what makes the claim
 * exclusive.
 */
export async function claimPendingEvents(limit: number): Promise<PendingEvent[]> {
  const cutoff = new Date(Date.now() - CLAIM_MIN_AGE_MS)
  const claimable = and(
    eq(metaConversionEvents.status, 'pending'),
    lt(metaConversionEvents.createdAt, cutoff),
  )

  // The ranking lives in an `IN` subquery because an UPDATE cannot carry a
  // window function in its own WHERE clause.
  const withinTenantQuota = sql`(
    select ranked.id from (
      select
        ${metaConversionEvents.id} as id,
        ${metaConversionEvents.createdAt} as created_at,
        row_number() over (
          partition by ${metaConversionEvents.tenantId}
          order by ${metaConversionEvents.createdAt}
        ) as tenant_rank
      from ${metaConversionEvents}
      where ${claimable}
    ) ranked
    where ranked.tenant_rank <= ${MAX_EVENTS_PER_TENANT}
    order by ranked.created_at
    limit ${limit}
  )`

  const rows = await db
    .update(metaConversionEvents)
    .set({ status: 'sending', claimedAt: new Date() })
    .where(
      and(
        eq(metaConversionEvents.status, 'pending'),
        inArray(metaConversionEvents.id, withinTenantQuota),
      ),
    )
    .returning({
      id: metaConversionEvents.id,
      tenantId: metaConversionEvents.tenantId,
      prospectId: metaConversionEvents.prospectId,
      patientId: metaConversionEvents.patientId,
      eventName: metaConversionEvents.eventName,
      eventId: metaConversionEvents.eventId,
      eventTime: metaConversionEvents.eventTime,
      value: metaConversionEvents.value,
      actionSource: metaConversionEvents.actionSource,
      payload: metaConversionEvents.payload,
      createdAt: metaConversionEvents.createdAt,
    })

  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const patientIds = await resolveConvertedPatients(ordered.filter((row) => !row.patientId))

  return ordered.map((row) => ({
    ...row,
    eventName: row.eventName as MetaEventName,
    actionSource: row.actionSource as MetaActionSource | null,
    patientId:
      row.patientId ??
      (row.prospectId ? patientIds.get(`${row.tenantId}:${row.prospectId}`) ?? null : null),
  }))
}

/**
 * Claims one known row, for the inline paths that already hold everything a
 * send needs. False means another sender owns it, or it is no longer pending
 * at all, and the caller must not send.
 */
export async function claimEventForSending(tenantId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(metaConversionEvents)
    .set({ status: 'sending', claimedAt: new Date() })
    .where(
      and(
        eq(metaConversionEvents.tenantId, tenantId),
        eq(metaConversionEvents.id, id),
        eq(metaConversionEvents.status, 'pending'),
      ),
    )
    .returning({ id: metaConversionEvents.id })

  return rows.length > 0
}

/** Hands a claimed row back unsent, for a sender that decided not to send it. */
export async function releaseEventClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  await db
    .update(metaConversionEvents)
    .set({ status: 'pending', claimedAt: null })
    .where(and(eq(metaConversionEvents.status, 'sending'), inArray(metaConversionEvents.id, ids)))
}

/**
 * Returns rows whose sender died mid-send. Without this a crashed run parks
 * its claimed rows in `sending` forever and nothing ever picks them up again.
 */
export async function reapStuckClaims(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SENDING_CLAIM_TIMEOUT_MS)

  const rows = await db
    .update(metaConversionEvents)
    .set({ status: 'pending', claimedAt: null })
    .where(
      and(eq(metaConversionEvents.status, 'sending'), lt(metaConversionEvents.claimedAt, cutoff)),
    )
    .returning({ id: metaConversionEvents.id })

  return rows.length
}

/**
 * Keyed by tenant as well as prospect id so a row can never pick up another
 * tenant's patient link.
 */
async function resolveConvertedPatients(
  rows: { tenantId: string; prospectId: string | null }[],
): Promise<Map<string, string | null>> {
  const prospectIds = [...new Set(rows.map((row) => row.prospectId).filter((id): id is string => Boolean(id)))]
  if (prospectIds.length === 0) return new Map()

  const links = await db
    .select({
      id: prospects.id,
      tenantId: prospects.tenantId,
      convertedPatientId: prospects.convertedPatientId,
    })
    .from(prospects)
    .where(inArray(prospects.id, prospectIds))

  return new Map(links.map((link) => [`${link.tenantId}:${link.id}`, link.convertedPatientId]))
}

export interface EventOutcomeCounts {
  sent: number
  failed: number
}

/**
 * The shared sender records each row's outcome itself and returns nothing, so
 * the cron reads the statuses back to report what the run actually did.
 */
export async function countEventOutcomes(tenantId: string, ids: string[]): Promise<EventOutcomeCounts> {
  if (ids.length === 0) return { sent: 0, failed: 0 }

  const rows = await db
    .select({ status: metaConversionEvents.status })
    .from(metaConversionEvents)
    .where(and(eq(metaConversionEvents.tenantId, tenantId), inArray(metaConversionEvents.id, ids)))

  let sent = 0
  let failed = 0
  for (const row of rows) {
    if (row.status === 'sent') sent += 1
    else if (row.status === 'failed') failed += 1
  }

  return { sent, failed }
}

export async function listRecentEvents(tenantId: string, limit: number): Promise<RecentEvent[]> {
  const rows = await db
    .select({
      id: metaConversionEvents.id,
      prospectId: metaConversionEvents.prospectId,
      eventName: metaConversionEvents.eventName,
      eventId: metaConversionEvents.eventId,
      status: metaConversionEvents.status,
      skipReason: metaConversionEvents.skipReason,
      attempts: metaConversionEvents.attempts,
      lastError: metaConversionEvents.lastError,
      fbTraceId: metaConversionEvents.fbTraceId,
      sentAt: metaConversionEvents.sentAt,
      createdAt: metaConversionEvents.createdAt,
    })
    .from(metaConversionEvents)
    .where(eq(metaConversionEvents.tenantId, tenantId))
    .orderBy(desc(metaConversionEvents.createdAt))
    .limit(limit)

  return rows
}

export async function hasScheduleForProspect(tenantId: string, prospectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: metaConversionEvents.id })
    .from(metaConversionEvents)
    .where(
      and(
        eq(metaConversionEvents.tenantId, tenantId),
        eq(metaConversionEvents.prospectId, prospectId),
        eq(metaConversionEvents.eventName, 'Schedule'),
        // A `skipped` row never reached Meta and never will, so it must not
        // block the real one. A row parked `pending` for a clinic that has
        // not finished connecting still will, and does block it.
        ne(metaConversionEvents.status, 'skipped'),
      ),
    )
    .limit(1)

  return Boolean(row)
}

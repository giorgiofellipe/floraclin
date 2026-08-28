import { db } from '@/db/client'
import { metaConversionEvents, prospects } from '@/db/schema'
import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import type { MetaEventName } from '@/lib/meta/types'

export const MAX_ATTEMPTS = 8
const CLAIM_MIN_AGE_MS = 60_000

export interface InsertConversionEventInput {
  tenantId: string
  prospectId: string | null
  patientId?: string | null
  eventName: MetaEventName
  eventId: string
  eventTime: Date
  value?: string | null
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

export async function markEventSent(tenantId: string, id: string, fbTraceId?: string): Promise<void> {
  await db
    .update(metaConversionEvents)
    .set({ status: 'sent', sentAt: new Date(), fbTraceId: fbTraceId ?? null })
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id)))
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
  const scope = and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id))

  if (kind !== 'transient') {
    const status: EventFailureStatus = kind === 'invalid' ? 'failed' : 'pending'
    await db.update(metaConversionEvents).set({ status, lastError: message }).where(scope)
    return status
  }

  const [current] = await db
    .select({ attempts: metaConversionEvents.attempts })
    .from(metaConversionEvents)
    .where(scope)
    .limit(1)

  const attempts = (current?.attempts ?? 0) + 1
  const status: EventFailureStatus = attempts < MAX_ATTEMPTS ? 'pending' : 'failed'

  await db.update(metaConversionEvents).set({ attempts, status, lastError: message }).where(scope)

  return status
}

export async function markEventSkipped(tenantId: string, id: string, reason: string): Promise<void> {
  await db
    .update(metaConversionEvents)
    .set({ status: 'skipped', skipReason: reason })
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id)))
}

/**
 * Selects, it does not claim: the row lock dies with the transaction that took
 * it and nothing marks a row in flight, so two overlapping runs can pick the
 * same row and send it twice. Meta dedups on event_id, which is what makes
 * that safe.
 */
export async function selectPendingEvents(limit: number): Promise<PendingEvent[]> {
  const rows = await db.transaction(async (trx) => {
    const cutoff = new Date(Date.now() - CLAIM_MIN_AGE_MS)

    return trx
      .select({
        id: metaConversionEvents.id,
        tenantId: metaConversionEvents.tenantId,
        prospectId: metaConversionEvents.prospectId,
        patientId: metaConversionEvents.patientId,
        eventName: metaConversionEvents.eventName,
        eventId: metaConversionEvents.eventId,
        eventTime: metaConversionEvents.eventTime,
        value: metaConversionEvents.value,
        payload: metaConversionEvents.payload,
        createdAt: metaConversionEvents.createdAt,
      })
      .from(metaConversionEvents)
      .where(and(eq(metaConversionEvents.status, 'pending'), lt(metaConversionEvents.createdAt, cutoff)))
      .orderBy(asc(metaConversionEvents.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true })
  })

  const patientIds = await resolveConvertedPatients(rows.filter((row) => !row.patientId))

  return rows.map((row) => ({
    ...row,
    eventName: row.eventName as MetaEventName,
    patientId:
      row.patientId ??
      (row.prospectId ? patientIds.get(`${row.tenantId}:${row.prospectId}`) ?? null : null),
  }))
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
        // A Schedule written while the clinic was unconnected is a `skipped`
        // row with no payload: it never reached Meta, so it must not block
        // the real one.
        ne(metaConversionEvents.status, 'skipped'),
      ),
    )
    .limit(1)

  return Boolean(row)
}

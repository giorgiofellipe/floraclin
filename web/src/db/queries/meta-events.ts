import { db } from '@/db/client'
import { metaConversionEvents } from '@/db/schema'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { MetaEventName } from '@/lib/meta/types'

const MAX_ATTEMPTS = 8
const CLAIM_MIN_AGE_MS = 60_000

export interface InsertConversionEventInput {
  tenantId: string
  prospectId: string | null
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
  eventName: string
  eventId: string
  eventTime: Date
  value: string | null
  currency: string
  payload: unknown
  attempts: number
}

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

export async function markEventFailure(
  tenantId: string,
  id: string,
  kind: 'transient' | 'invalid' | 'auth',
  message: string,
): Promise<void> {
  const [current] = await db
    .select({ attempts: metaConversionEvents.attempts })
    .from(metaConversionEvents)
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id)))
    .limit(1)

  const attempts = (current?.attempts ?? 0) + 1
  // Invalid payloads and dead tokens never recover on retry; only a
  // transient failure gets the attempt budget below.
  const status = kind === 'transient' && attempts < MAX_ATTEMPTS ? 'pending' : 'failed'

  await db
    .update(metaConversionEvents)
    .set({ attempts, status, lastError: message })
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id)))
}

export async function markEventSkipped(tenantId: string, id: string, reason: string): Promise<void> {
  await db
    .update(metaConversionEvents)
    .set({ status: 'skipped', skipReason: reason })
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.id, id)))
}

export async function claimPendingEvents(limit: number): Promise<PendingEvent[]> {
  return db.transaction(async (trx) => {
    const cutoff = new Date(Date.now() - CLAIM_MIN_AGE_MS)

    const rows = await trx
      .select()
      .from(metaConversionEvents)
      .where(and(eq(metaConversionEvents.status, 'pending'), lt(metaConversionEvents.createdAt, cutoff)))
      .orderBy(asc(metaConversionEvents.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true })

    if (rows.length === 0) {
      return []
    }

    const ids = rows.map((row) => row.id)
    await trx
      .update(metaConversionEvents)
      .set({ attempts: sql`${metaConversionEvents.attempts} + 1` })
      .where(inArray(metaConversionEvents.id, ids))

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      prospectId: row.prospectId,
      eventName: row.eventName,
      eventId: row.eventId,
      eventTime: row.eventTime,
      value: row.value,
      currency: row.currency,
      payload: row.payload,
      attempts: row.attempts + 1,
    }))
  })
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
    .orderBy(sql`${metaConversionEvents.createdAt} DESC`)
    .limit(limit)

  return rows
}

export async function hasEvent(tenantId: string, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: metaConversionEvents.id })
    .from(metaConversionEvents)
    .where(and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.eventId, eventId)))
    .limit(1)

  return Boolean(row)
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
      ),
    )
    .limit(1)

  return Boolean(row)
}

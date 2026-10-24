import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { appointments, patients, photoAssets, tenantUsers, users } from '@/db/schema'
import type { TimelineStage } from '@/types'
import type { AnalyticsEventProperties } from './events'
import { trackServerEvent } from './server'

/**
 * Server events that need a lookup first. Each lookup runs inside the
 * `after()` callback, and only when analytics is configured, so none of them
 * costs the request (or a deployment without PostHog) anything.
 */

interface Actor {
  userId: string
  tenantId: string
  isPlatformAdmin: boolean
}

type TenantTable = typeof patients | typeof appointments | typeof photoAssets

/**
 * True when no row of the tenant is older than the one just inserted, by
 * `(created_at, id)`. The request that inserted the earliest row fires;
 * concurrent first inserts can, rarely, both fire. Stops at the first older
 * row instead of sorting all of the tenant's rows. Soft-deleted rows count:
 * "first" means the first ever, so deleting and re-creating a patient does
 * not fire again.
 */
async function isTenantsFirst(table: TenantTable, tenantId: string, insertedId: string) {
  const inserted = db.select({ createdAt: table.createdAt }).from(table).where(eq(table.id, insertedId))
  const [older] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), sql`(${table.createdAt}, ${table.id}) < ((${inserted}), ${insertedId}::uuid)`))
    .limit(1)
  return !older
}

/**
 * Platform admins' rows (support work inside a customer's clinic) send
 * nothing, but still count as the tenant's first.
 */
function trackTenantFirst<E extends 'first_patient_created' | 'first_appointment_created' | 'first_photo_uploaded'>(
  event: E,
  table: TenantTable,
  actor: Actor,
  insertedId: string,
  properties: AnalyticsEventProperties[E],
): void {
  if (actor.isPlatformAdmin) return
  trackServerEvent(
    event,
    async () => ((await isTenantsFirst(table, actor.tenantId, insertedId)) ? { distinctId: actor.userId, tenantId: actor.tenantId } : null),
    properties,
  )
}

export function trackFirstPatientCreated(actor: Actor, patientId: string): void {
  trackTenantFirst('first_patient_created', patients, actor, patientId, {})
}

/**
 * Staff-created appointments only. A booking from the public page has no
 * signed-in user to attribute it to, but it still counts as the tenant's
 * first, so a staff appointment after it does not fire.
 */
export function trackFirstAppointmentCreated(actor: Actor, appointmentId: string): void {
  trackTenantFirst('first_appointment_created', appointments, actor, appointmentId, {})
}

export function trackFirstPhotoUploaded(actor: Actor, photoAssetId: string, kind: TimelineStage): void {
  trackTenantFirst('first_photo_uploaded', photoAssets, actor, photoAssetId, { kind })
}

/** The confirm route only knows the address; the event is keyed by the user id behind it. */
export function trackEmailConfirmed(email: string): void {
  trackServerEvent(
    'email_confirmed',
    async () => {
      const [row] = await db
        .select({ userId: users.id, tenantId: tenantUsers.tenantId })
        .from(users)
        .leftJoin(tenantUsers, and(eq(tenantUsers.userId, users.id), eq(tenantUsers.isActive, true)))
        .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
        .limit(1)
      return row ? { distinctId: row.userId, tenantId: row.tenantId } : null
    },
    {},
  )
}

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { appointments, patients, photoAssets, tenantUsers, users } from '@/db/schema'
import type { TimelineStage } from '@/types'
import { trackServerEvent } from './server'

/**
 * Server events that need a lookup first. Each lookup runs inside the
 * `after()` callback, and only when analytics is configured, so none of them
 * costs the request (or a deployment without PostHog) anything.
 */

interface Actor {
  userId: string
  tenantId: string
}

/**
 * True when the row just inserted is the tenant's earliest. Exactly one row is
 * the earliest, so the request that inserted it fires even when another row
 * lands before this lookup runs. Soft-deleted rows count: "first" means the
 * first ever, so deleting and re-creating a patient does not fire again.
 */
async function isTenantsFirst(
  table: typeof patients | typeof appointments | typeof photoAssets,
  tenantId: string,
  insertedId: string,
) {
  const [earliest] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.tenantId, tenantId))
    .orderBy(asc(table.createdAt), asc(table.id))
    .limit(1)
  return earliest?.id === insertedId
}

export function trackFirstPatientCreated(actor: Actor, patientId: string): void {
  trackServerEvent(
    'first_patient_created',
    async () => ((await isTenantsFirst(patients, actor.tenantId, patientId)) ? { distinctId: actor.userId, tenantId: actor.tenantId } : null),
    {},
  )
}

/**
 * Staff-created appointments only. A booking from the public page has no
 * signed-in user to attribute it to, but it still counts as the tenant's
 * first, so a staff appointment after it does not fire.
 */
export function trackFirstAppointmentCreated(actor: Actor, appointmentId: string): void {
  trackServerEvent(
    'first_appointment_created',
    async () => ((await isTenantsFirst(appointments, actor.tenantId, appointmentId)) ? { distinctId: actor.userId, tenantId: actor.tenantId } : null),
    {},
  )
}

export function trackFirstPhotoUploaded(actor: Actor, photoAssetId: string, kind: TimelineStage): void {
  trackServerEvent(
    'first_photo_uploaded',
    async () => ((await isTenantsFirst(photoAssets, actor.tenantId, photoAssetId)) ? { distinctId: actor.userId, tenantId: actor.tenantId } : null),
    { kind },
  )
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

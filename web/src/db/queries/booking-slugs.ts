import { and, count, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { auditLogs, tenantSlugHistory, tenants } from '@/db/schema'
import { isUniqueViolation } from '@/lib/errors'
import { BOOKING_SLUG_CHANGES_PER_DAY, SLUG_RESERVATION_DAYS } from '@/lib/booking-slug'

export { BOOKING_SLUG_CHANGES_PER_DAY, BOOKING_SLUG_MESSAGES, SLUG_RESERVATION_DAYS } from '@/lib/booking-slug'

type DbExecutor = typeof db

const DAY_MS = 24 * 60 * 60 * 1000

const BOOKING_SLUG_CHANGE_WINDOW_MS = DAY_MS

/** Audit rows written by changeBookingSlug; the rolling change limit counts them. */
export const BOOKING_SLUG_AUDIT_ENTITY = 'booking_slug'

/** Whether a link retired at `retiredAt` is still held for (and redirects to) the clinic that left it. */
export function isSlugReservationActive(retiredAt: Date, now: Date): boolean {
  return now.getTime() - retiredAt.getTime() < SLUG_RESERVATION_DAYS * DAY_MS
}

/**
 * True when `slug` is held back for a clinic other than `tenantId` that moved off
 * it less than SLUG_RESERVATION_DAYS ago. The clinic's own old links are not.
 */
export async function isSlugReservedForAnotherTenant(
  executor: Pick<DbExecutor, 'select'>,
  slug: string,
  tenantId: string | undefined,
  now = new Date(),
): Promise<boolean> {
  const [row] = await executor
    .select({ tenantId: tenantSlugHistory.tenantId, retiredAt: tenantSlugHistory.retiredAt })
    .from(tenantSlugHistory)
    .where(eq(tenantSlugHistory.slug, slug))
    .limit(1)
  return !!row && row.tenantId !== tenantId && isSlugReservationActive(row.retiredAt, now)
}

/** True when no other clinic holds `slug` now or has it reserved from a recent change. */
export async function isBookingSlugFree(
  executor: Pick<DbExecutor, 'select'>,
  slug: string,
  tenantId: string,
  now = new Date(),
): Promise<boolean> {
  const [holder] = await executor
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), ne(tenants.id, tenantId)))
    .limit(1)
  if (holder) return false
  return !(await isSlugReservedForAnotherTenant(executor, slug, tenantId, now))
}

/**
 * The current slug of the clinic that moved off `slug` less than
 * SLUG_RESERVATION_DAYS ago, for /c/<slug> to redirect to. Null when there is
 * none, the reservation is over, or the clinic was deleted.
 */
export async function findBookingSlugRedirect(slug: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ retiredAt: tenantSlugHistory.retiredAt, currentSlug: tenants.slug })
    .from(tenantSlugHistory)
    .innerJoin(tenants, eq(tenants.id, tenantSlugHistory.tenantId))
    .where(and(eq(tenantSlugHistory.slug, slug), isNull(tenants.deletedAt)))
    .limit(1)
  if (!row || row.currentSlug === slug || !isSlugReservationActive(row.retiredAt, now)) return null
  return row.currentSlug
}

/**
 * Transaction advisory locks, one per slug, in sorted order (no deadlocks), so
 * a slug cannot be retired by one clinic and claimed by another at once.
 */
async function lockSlugs(tx: Pick<DbExecutor, 'execute'>, slugs: string[]): Promise<void> {
  for (const slug of [...new Set(slugs)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'booking_slug:' + slug}))`)
  }
}

export type ChangeBookingSlugResult =
  | { outcome: 'updated'; slug: string; previousSlug: string }
  | { outcome: 'unchanged'; slug: string }
  | { outcome: 'taken' }
  | { outcome: 'rate_limited' }
  | { outcome: 'not_found' }

/**
 * Moves the clinic's booking link to `slug` (already validated and normalised).
 * The old one goes to tenant_slug_history: it redirects to the new one and stays
 * reserved for this clinic for SLUG_RESERVATION_DAYS. At most
 * BOOKING_SLUG_CHANGES_PER_DAY changes in a rolling 24 h window, counted from
 * the audit rows this writes.
 *
 * Locks the tenant row (so the limit holds under concurrent saves) and both
 * slugs (lockSlugs). tenants_slug_unique backs the checks and maps to 'taken'
 * (the history insert upserts, so its primary key never conflicts).
 */
export async function changeBookingSlug(input: {
  tenantId: string
  userId: string
  slug: string
  now?: Date
}): Promise<ChangeBookingSlugResult> {
  const now = input.now ?? new Date()
  try {
    return await db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .for('update')
      if (!tenant) return { outcome: 'not_found' } as const
      if (tenant.slug === input.slug) return { outcome: 'unchanged', slug: input.slug } as const

      const [recent] = await tx
        .select({ n: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, input.tenantId),
            eq(auditLogs.entityType, BOOKING_SLUG_AUDIT_ENTITY),
            eq(auditLogs.action, 'update'),
            gt(auditLogs.createdAt, new Date(now.getTime() - BOOKING_SLUG_CHANGE_WINDOW_MS)),
          ),
        )
      if ((recent?.n ?? 0) >= BOOKING_SLUG_CHANGES_PER_DAY) return { outcome: 'rate_limited' } as const

      await lockSlugs(tx, [tenant.slug, input.slug])
      if (!(await isBookingSlugFree(tx, input.slug, input.tenantId, now))) return { outcome: 'taken' } as const

      // Whatever the new link left behind (this clinic's own old link, or
      // another clinic's whose reservation is over) no longer redirects.
      await tx.delete(tenantSlugHistory).where(eq(tenantSlugHistory.slug, input.slug))
      await tx
        .insert(tenantSlugHistory)
        .values({ slug: tenant.slug, tenantId: input.tenantId, retiredAt: now })
        .onConflictDoUpdate({ target: tenantSlugHistory.slug, set: { tenantId: input.tenantId, retiredAt: now } })
      await tx.update(tenants).set({ slug: input.slug, updatedAt: now }).where(eq(tenants.id, input.tenantId))
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'update',
        entityType: BOOKING_SLUG_AUDIT_ENTITY,
        entityId: input.tenantId,
        changes: { slug: { old: tenant.slug, new: input.slug } },
        createdAt: now,
      })
      return { outcome: 'updated', slug: input.slug, previousSlug: tenant.slug } as const
    })
  } catch (err) {
    // The violation aborted the transaction; it is rolled back by the time we get here.
    if (isUniqueViolation(err, 'tenants_slug_unique')) {
      return { outcome: 'taken' }
    }
    throw err
  }
}

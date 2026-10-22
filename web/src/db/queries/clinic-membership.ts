import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants, tenantUsers } from '@/db/schema'

export type ClinicMemberships = {
  /** Active memberships in tenants that are not soft-deleted. */
  liveTenantIds: string[]
  /**
   * Has active memberships and every one of them is in a suspended
   * (soft-deleted) tenant. Decided here once so the page and the action
   * cannot disagree about it.
   */
  suspendedOnly: boolean
  /**
   * No membership row at all, active or not: a brand-new account. Only these
   * get a clinic created automatically after Google sign-up. Someone removed
   * from a clinic (an inactive membership) still sees the clinic form, so a
   * former staff member signing in never gets a trial clinic they did not ask
   * for.
   */
  neverMember: boolean
}

/**
 * What the self-signup flow needs to know about a user's clinics.
 *
 * Must agree with the jwt callback, which resolves the session tenant through
 * a join that skips soft-deleted tenants. Counting a suspended tenant's
 * membership here as "already has a clinic" sent Google sign-ups into a loop:
 * the action said the clinic existed, the refreshed session still had no
 * tenant, and middleware sent the user back to clinic details.
 */
export async function getClinicMemberships(userId: string): Promise<ClinicMemberships> {
  const allRows = await db
    .select({ tenantId: tenantUsers.tenantId, deletedAt: tenants.deletedAt, isActive: tenantUsers.isActive })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.userId, userId))

  const rows = allRows.filter((r) => r.isActive)
  const liveTenantIds = rows.filter((r) => r.deletedAt === null).map((r) => r.tenantId)
  return {
    liveTenantIds,
    suspendedOnly: liveTenantIds.length === 0 && rows.length > 0,
    neverMember: allRows.length === 0,
  }
}

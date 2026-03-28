import { db } from '@/db/client'
import { tenantUsers } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

/**
 * Verify that a record belongs to the given tenant before allowing writes
 * with foreign IDs. Throws if record not found or belongs to another tenant.
 */
export async function verifyTenantOwnership(
  tenantId: string,
  table: { id: any; tenantId: any; deletedAt?: any },
  id: string,
  label = 'Record'
) {
  const conditions = [eq(table.id, id), eq(table.tenantId, tenantId)]
  if (table.deletedAt) {
    conditions.push(isNull(table.deletedAt))
  }

  const [record] = await db
    .select({ id: table.id })
    .from(table as any)
    .where(and(...conditions))
    .limit(1)

  if (!record) {
    throw new Error(`${label} not found or does not belong to this tenant`)
  }
}

/**
 * Verify that a user belongs to the given tenant (via tenantUsers junction table).
 * Users don't have tenantId directly, so we check the tenantUsers table.
 */
export async function verifyUserBelongsToTenant(
  tenantId: string,
  userId: string,
  label = 'User'
) {
  const [record] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.isActive, true)
      )
    )
    .limit(1)

  if (!record) {
    throw new Error(`${label} not found or does not belong to this tenant`)
  }
}

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import type { appointments, patients, photoAssets } from '@/db/schema'

export type TenantFirstTable = typeof patients | typeof appointments | typeof photoAssets

/**
 * True when no row of the tenant is older than the one just inserted, by
 * `(created_at, id)`. The request that inserted the earliest row fires;
 * concurrent first inserts can, rarely, both fire. Stops at the first older
 * row instead of sorting all of the tenant's rows. Soft-deleted rows count:
 * "first" means the first ever, so deleting and re-creating a patient does
 * not fire again.
 */
export async function isTenantsFirst(table: TenantFirstTable, tenantId: string, insertedId: string) {
  const inserted = db.select({ createdAt: table.createdAt }).from(table).where(eq(table.id, insertedId))
  const [older] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), sql`(${table.createdAt}, ${table.id}) < ((${inserted}), ${insertedId}::uuid)`))
    .limit(1)
  return !older
}

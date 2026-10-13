import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getAppUrl } from '@/lib/app-url'

function sign(tenantId: string): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set')
  return createHmac('sha256', secret).update(`lifecycle-opt-out:${tenantId}`).digest('hex')
}

export function lifecycleOptOutUrl(tenantId: string): string {
  return `${getAppUrl()}/api/lifecycle/opt-out?t=${tenantId}&s=${sign(tenantId)}`
}

export function isValidLifecycleOptOut(tenantId: string, signature: string): boolean {
  const expected = Buffer.from(sign(tenantId))
  const given = Buffer.from(signature)
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export async function optOutTenantLifecycle(tenantId: string): Promise<boolean> {
  const rows = await db
    .update(tenants)
    .set({
      lifecycleOptedOutAt: sql`coalesce(${tenants.lifecycleOptedOutAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id })
  return rows.length > 0
}

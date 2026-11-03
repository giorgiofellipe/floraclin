import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { markImportHelpRequested, updateTenant } from '../tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

describeIntegration('updateTenant settings (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  afterEach(async () => {
    if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it('does not erase a key written after the form loaded its settings', async () => {
    const id = randomUUID()
    const loaded = { online_booking_enabled: true, monthly_revenue_goal: 1000 }
    await db.insert(tenants).values({ id, name: 'Clínica Bela', slug: `update-tenant-${id}`, settings: loaded })
    tenantIds.push(id)
    const request = await markImportHelpRequested(id)

    await updateTenant(id, { name: 'Clínica Bela', settings: { ...loaded, monthly_revenue_goal: 2000 } })

    const [row] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, id))
    expect(row.settings).toEqual({
      online_booking_enabled: true,
      monthly_revenue_goal: 2000,
      import_help_requested_at: request?.requestedAt,
    })
  })
})

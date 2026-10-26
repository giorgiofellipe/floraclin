import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { isPhoneNumberIdClaimedByAnotherTenant } from '../tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

// Without the caller excluded, a clinic re-saving its own number gets the
// "already connected to another clinic" 409.
describeIntegration('isPhoneNumberIdClaimedByAnotherTenant (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  afterEach(async () => {
    if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it("does not count the caller's own claim, only another clinic's", async () => {
    const holder = randomUUID()
    const phoneNumberId = `own-${holder}`
    await db.insert(tenants).values({
      id: holder,
      name: 'Clínica Teste',
      slug: `own-claim-${holder}`,
      settings: { whatsapp_mode: 'own', whatsapp_phone_number_id: phoneNumberId },
    })
    tenantIds.push(holder)

    expect(await isPhoneNumberIdClaimedByAnotherTenant(holder, phoneNumberId)).toBe(false)
    expect(await isPhoneNumberIdClaimedByAnotherTenant(randomUUID(), phoneNumberId)).toBe(true)
  })
})

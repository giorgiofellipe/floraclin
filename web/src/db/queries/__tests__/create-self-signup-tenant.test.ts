import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { financialAccounts, tenants, tenantUsers, users, whatsappAutomations } from '@/db/schema'
import { createSelfSignupTenant } from '../admin-tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

describeIntegration('createSelfSignupTenant (integration, requires test DB)', () => {
  const userIds: string[] = []

  async function insertUser() {
    const id = randomUUID()
    await db.insert(users).values({ id, email: `self-signup-${id}@test.local`, fullName: 'Ana Teste' })
    userIds.push(id)
    return id
  }

  afterEach(async () => {
    if (!userIds.length) return
    const ids = userIds.splice(0)
    const memberships = await db.select({ tenantId: tenantUsers.tenantId }).from(tenantUsers).where(inArray(tenantUsers.userId, ids))
    const tenantIds = memberships.map((m) => m.tenantId)
    await db.delete(tenantUsers).where(inArray(tenantUsers.userId, ids))
    if (tenantIds.length) {
      await db.delete(whatsappAutomations).where(inArray(whatsappAutomations.tenantId, tenantIds))
      await db.delete(financialAccounts).where(inArray(financialAccounts.tenantId, tenantIds))
      await db.delete(tenants).where(inArray(tenants.id, tenantIds))
    }
    await db.delete(users).where(inArray(users.id, ids))
  })

  // The clinic is created by the page on load, so two tabs can race here.
  it('creates exactly one clinic when two requests for the same user race', async () => {
    const userId = await insertUser()
    const input = { userId, clinicName: 'Clínica de Ana', phone: null, placeholderName: true }

    const results = await Promise.all([createSelfSignupTenant(input), createSelfSignupTenant(input)])

    expect(results.filter(Boolean)).toHaveLength(1)
    const rows = await db.select().from(tenantUsers).where(eq(tenantUsers.userId, userId))
    expect(rows).toHaveLength(1)
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, rows[0].tenantId))
    expect(tenant.phone).toBeNull()
    expect(tenant.settings).toEqual({ clinic_name_placeholder: true, clinic_slug_placeholder: true })
    // No lifecycle notice was shown on this path: onboarding stamps it.
    expect(tenant.lifecycleNoticeAt).toBeNull()
    const automations = await db.select().from(whatsappAutomations).where(eq(whatsappAutomations.tenantId, tenant.id))
    // Confirmação de consulta, lembrete de pagamento and cuidados pós-procedimento start on.
    expect(automations.sort((a, b) => a.trigger.localeCompare(b.trigger))).toEqual(
      ['appointment_confirmation', 'payment_reminder', 'post_procedure_care'].map((trigger) =>
        expect.objectContaining({ trigger, enabled: true, templateId: null, config: null, firstEnabledAt: expect.any(Date) }),
      ),
    )
  })

  it('stores plain settings for a clinic named on the form', async () => {
    const userId = await insertUser()

    const tenant = await createSelfSignupTenant({ userId, clinicName: 'Clínica Bela', phone: '11987654321' })

    expect(tenant?.settings).toEqual({})
    const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant!.id))
    expect(row.lifecycleNoticeAt).not.toBeNull()
  })
})

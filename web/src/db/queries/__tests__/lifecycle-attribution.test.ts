import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  patients,
  plans,
  tenantLifecycleClicks,
  tenantLifecycleMessages,
  tenants,
  tenantSubscriptions,
  whatsappAutomations,
} from '@/db/schema'
import { rowsFromExecuteResult } from '../admin-tenants'
import { recordLifecycleClick, updateLifecycleDeliveryStatusByMetaId } from '../lifecycle'
import { updateSubscriptionPlan } from '../subscriptions'
import { upsertAutomation } from '../whatsapp'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000a71b0'
const PLAN = '00000000-0000-0000-0000-0000000a71b1'
const REPORT_SQL = readFileSync(resolve(__dirname, '../../../../../docs/reports/lifecycle-attribution.sql'), 'utf8')

async function insertSend(messageKey: string, metaMessageId: string | null = null) {
  const [row] = await db.insert(tenantLifecycleMessages).values({
    tenantId: TENANT,
    messageKey,
    channel: 'whatsapp',
    status: 'sent',
    recipient: '5511999990000',
    metaMessageId,
  }).returning()
  return row
}

describeIntegration('lifecycle attribution (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Lifecycle Test', slug: 'lifecycle-test' }).onConflictDoNothing()
    await db.insert(plans).values({ id: PLAN, slug: 'lifecycle-test-plan', name: 'Lifecycle Test' }).onConflictDoNothing()
  })

  beforeEach(async () => {
    await db.delete(tenantLifecycleClicks).where(eq(tenantLifecycleClicks.tenantId, TENANT))
    await db.delete(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.tenantId, TENANT))
    await db.delete(patients).where(eq(patients.tenantId, TENANT))
    await db.delete(whatsappAutomations).where(eq(whatsappAutomations.tenantId, TENANT))
    await db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, TENANT))
  })

  it('records one click per send per hour', async () => {
    const send = await insertSend('trial_welcome')

    expect(await recordLifecycleClick({ id: send.id, tenantId: TENANT })).toBe(true)
    expect(await recordLifecycleClick({ id: send.id, tenantId: TENANT })).toBe(false)

    const clicks = await db.select().from(tenantLifecycleClicks).where(eq(tenantLifecycleClicks.lifecycleMessageId, send.id))
    expect(clicks).toHaveLength(1)
  })

  it('keeps read and delivered times when Meta sends older statuses late', async () => {
    const send = await insertSend('trial_welcome', 'wamid.order')
    const readAt = new Date('2026-10-16T12:05:00.000Z')

    await updateLifecycleDeliveryStatusByMetaId('wamid.order', { status: 'read', at: readAt })
    await updateLifecycleDeliveryStatusByMetaId('wamid.order', { status: 'delivered', at: new Date('2026-10-16T12:06:00.000Z') })

    const [row] = await db.select().from(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.id, send.id))
    expect(row.readAt).toEqual(readAt)
    expect(row.deliveredAt).toEqual(readAt)
  })

  it('sets first_paid_at and first_enabled_at once, so a recovery or re-enable keeps the first time', async () => {
    await db.insert(tenantSubscriptions).values({ tenantId: TENANT, planId: PLAN, currentPeriodEnd: new Date('2026-12-01') })
    await updateSubscriptionPlan(TENANT, PLAN, 'stripe', { status: 'active' })
    const [paid] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, TENANT))
    await updateSubscriptionPlan(TENANT, PLAN, 'stripe', { status: 'active' })
    const [repaid] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, TENANT))

    await upsertAutomation(TENANT, 'follow_up', { enabled: true })
    const [enabled] = await db.select().from(whatsappAutomations).where(eq(whatsappAutomations.tenantId, TENANT))
    await upsertAutomation(TENANT, 'follow_up', { enabled: false })
    await upsertAutomation(TENANT, 'follow_up', { enabled: true })
    const [reenabled] = await db.select().from(whatsappAutomations).where(eq(whatsappAutomations.tenantId, TENANT))

    expect(paid.firstPaidAt).not.toBeNull()
    expect(repaid.firstPaidAt).toEqual(paid.firstPaidAt)
    expect(enabled.firstEnabledAt).not.toBeNull()
    expect(reenabled.firstEnabledAt).toEqual(enabled.firstEnabledAt)
  })

  it('credits an activation to the last click within 7 days before it', async () => {
    const welcome = await insertSend('trial_welcome')
    const firstPatient = await insertSend('trial_first_patient')
    const patientAt = new Date('2026-10-10T12:00:00.000Z')
    await db.insert(tenantLifecycleClicks).values([
      { tenantId: TENANT, lifecycleMessageId: welcome.id, createdAt: new Date('2026-10-02T12:00:00.000Z') },
      { tenantId: TENANT, lifecycleMessageId: firstPatient.id, createdAt: new Date('2026-10-08T12:00:00.000Z') },
      { tenantId: TENANT, lifecycleMessageId: welcome.id, createdAt: new Date('2026-10-11T12:00:00.000Z') },
    ])
    await db.insert(patients).values({ tenantId: TENANT, fullName: 'Paciente', phone: '11999990000', createdAt: patientAt })
    // 9 days after the newest click, so outside the window.
    await db.insert(whatsappAutomations).values({ tenantId: TENANT, trigger: 'follow_up', enabled: true, firstEnabledAt: new Date('2026-10-20T12:00:00.000Z') })

    const rows = rowsFromExecuteResult<{ message_key: string; clicked: string; first_patient: string; automation_enabled: string }>(
      await db.execute(sql.raw(REPORT_SQL)),
    ).filter((r) => ['trial_welcome', 'trial_first_patient'].includes(r.message_key))

    expect(rows.map((r) => [r.message_key, Number(r.clicked), Number(r.first_patient), Number(r.automation_enabled)])).toEqual([
      ['trial_first_patient', 1, 1, 0],
      ['trial_welcome', 1, 0, 0],
    ])
  })
})

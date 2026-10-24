import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantLifecycleMessages, tenants } from '@/db/schema'
import {
  claimLifecycleSend,
  getCompletedLifecycleKeys,
  isFirstTemplateNotApprovedSkipToday,
  recordSkippedLifecycleSend,
} from '../lifecycle'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000a71c0'
const OTHER = '00000000-0000-0000-0000-0000000a71c1'
const TENANTS = [TENANT, OTHER]
const MESSAGE_KEYS = ['trial_final', 'trial_help']

const skip = (tenantId: string, messageKey = 'trial_final') =>
  recordSkippedLifecycleSend({
    tenantId,
    messageKey,
    channel: 'whatsapp',
    recipient: '5511999990000',
    reason: 'template_not_approved',
  })

describeIntegration('lifecycle template_not_approved skips (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: TENANT, name: 'Lifecycle Skip Test', slug: 'lifecycle-skip-test' },
      { id: OTHER, name: 'Lifecycle Skip Test 2', slug: 'lifecycle-skip-test-2' },
    ]).onConflictDoNothing()
  })

  beforeEach(async () => {
    const m = tenantLifecycleMessages
    await db.delete(m).where(inArray(m.tenantId, TENANTS))
    // The first-skip-of-the-day check spans every tenant: clear all of today's
    // competing skip rows for these keys, not only this test's tenants.
    await db
      .delete(m)
      .where(
        and(
          inArray(m.messageKey, MESSAGE_KEYS),
          eq(m.channel, 'whatsapp'),
          eq(m.status, 'skipped'),
          eq(m.error, 'template_not_approved'),
        ),
      )
  })

  afterAll(async () => {
    await db.delete(tenantLifecycleMessages).where(inArray(tenantLifecycleMessages.tenantId, TENANTS))
    await db.delete(tenants).where(inArray(tenants.id, TENANTS))
  })

  it('keeps a key skipped for a clinic complete, so approving the template later never resends it', async () => {
    expect(await skip(TENANT)).toEqual(expect.any(String))
    const emailId = await claimLifecycleSend({ tenantId: TENANT, messageKey: 'trial_final', channel: 'email', recipient: 'a@b.c' })
    await db.update(tenantLifecycleMessages).set({ status: 'sent' }).where(eq(tenantLifecycleMessages.id, emailId!))

    expect(await getCompletedLifecycleKeys(TENANT)).toEqual(new Set(['trial_final']))
    // Template approved now: the WhatsApp claim for the same key still loses to the skip row.
    expect(await claimLifecycleSend({ tenantId: TENANT, messageKey: 'trial_final', channel: 'whatsapp', recipient: '5511999990000' })).toBeNull()
  })

  it('returns null for a skip row that already existed', async () => {
    expect(await skip(TENANT)).toEqual(expect.any(String))
    expect(await skip(TENANT)).toBeNull()
  })

  it('reports only the first skip of the day for a key as first', async () => {
    const first = (await skip(TENANT))!
    const second = (await skip(OTHER))!
    const otherKey = (await skip(OTHER, 'trial_help'))!

    expect(await isFirstTemplateNotApprovedSkipToday('trial_final', first)).toBe(true)
    expect(await isFirstTemplateNotApprovedSkipToday('trial_final', second)).toBe(false)
    expect(await isFirstTemplateNotApprovedSkipToday('trial_help', otherKey)).toBe(true)
  })
})

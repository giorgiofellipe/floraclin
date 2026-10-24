import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
    await db.delete(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.tenantId, TENANT))
    await db.delete(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.tenantId, OTHER))
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

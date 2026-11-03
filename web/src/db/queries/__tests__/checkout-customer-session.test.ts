import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { plans, tenantSubscriptions, tenants } from '@/db/schema'
import { claimStripeCustomerId, clearCheckoutSessionId, swapCheckoutSessionId } from '../subscriptions'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

// Two checkout requests race on the same row; only a real database shows whether the conditional writes hold.
describeIntegration('checkout customer and session columns (integration, requires test DB)', () => {
  const planId = randomUUID()
  const tenantIds: string[] = []

  beforeAll(async () => {
    await db.insert(plans).values({ id: planId, slug: `checkout-race-${planId}`, name: 'Trial' })
  })
  afterEach(async () => {
    if (tenantIds.length === 0) return
    const ids = tenantIds.splice(0)
    await db.delete(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, ids))
    await db.delete(tenants).where(inArray(tenants.id, ids))
  })
  afterAll(async () => {
    await db.delete(plans).where(eq(plans.id, planId))
  })

  async function insertTenant() {
    const id = randomUUID()
    await db.insert(tenants).values({ id, name: 'Clínica de Ana', slug: `checkout-race-${id}` })
    await db.insert(tenantSubscriptions).values({ tenantId: id, planId, currentPeriodEnd: new Date('2999-01-01T00:00:00.000Z') })
    tenantIds.push(id)
    return id
  }
  const rowOf = async (id: string) =>
    (await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)))[0]

  // Regression: a second request overwrote the stored customer, leaving the clinic on two Stripe customers.
  it('keeps the first stored customer and hands it to every racing claim', async () => {
    const id = await insertTenant()

    const results = await Promise.all([claimStripeCustomerId(id, 'cus_a'), claimStripeCustomerId(id, 'cus_b')])

    const stored = (await rowOf(id)).stripeCustomerId
    expect(['cus_a', 'cus_b']).toContain(stored)
    expect(results).toEqual([stored, stored])
    expect(await claimStripeCustomerId(id, 'cus_c')).toBe(stored)
  })

  it('returns null for a tenant without a subscription row', async () => {
    expect(await claimStripeCustomerId(randomUUID(), 'cus_a')).toBeNull()
  })

  // Regression: two racing checkouts both saw no previous session, so one stayed open with stale terms.
  it('hands each racing swap the session it replaced, so every older session gets expired', async () => {
    const id = await insertTenant()
    expect(await swapCheckoutSessionId(id, 'cs_1')).toBeNull()

    const previous = await Promise.all([swapCheckoutSessionId(id, 'cs_2'), swapCheckoutSessionId(id, 'cs_3')])

    const latest = (await rowOf(id)).checkoutSessionId
    expect(previous).toContain('cs_1')
    expect(previous.filter((p) => p !== 'cs_1')).toEqual([latest === 'cs_2' ? 'cs_3' : 'cs_2'])
  })

  it('clears the stored session only when it is the one that ended', async () => {
    const id = await insertTenant()
    await swapCheckoutSessionId(id, 'cs_new')

    await clearCheckoutSessionId(id, 'cs_old')
    expect((await rowOf(id)).checkoutSessionId).toBe('cs_new')

    await clearCheckoutSessionId(id, 'cs_new')
    expect((await rowOf(id)).checkoutSessionId).toBeNull()
  })
})

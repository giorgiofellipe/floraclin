import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { untilAdvisoryLockWaiter } from './advisory-lock-waiter'
import { billingCardFingerprints, referralRewardEvents, tenantReferrals, tenants } from '@/db/schema'
import type { ReferralState } from '@/lib/referral/types'
import {
  bindReferralSubscription,
  getReferralById,
  insertReferral,
  listReconcileUnits,
  markReferralsReconciled,
  recordCardFingerprints,
  updateReferralState,
  withReferrerRewardLock,
} from '../referrals'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const REFERRER_A = '00000000-0000-0000-0000-0000000b3a01'
const REFERRER_B = '00000000-0000-0000-0000-0000000b3a02'
const REFERRED_1 = '00000000-0000-0000-0000-0000000b3a11'
const REFERRED_2 = '00000000-0000-0000-0000-0000000b3a12'
const ALL_TENANTS = [REFERRER_A, REFERRER_B, REFERRED_1, REFERRED_2]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function stateOf(row: typeof tenantReferrals.$inferSelect, patch: Partial<ReferralState>): ReferralState {
  return {
    status: row.status as ReferralState['status'],
    pausedReason: null,
    ineligibleReason: null,
    stripeSubscriptionId: row.stripeSubscriptionId,
    firstPaidAt: row.firstPaidAt,
    qualifiedAt: row.qualifiedAt,
    qualifyingInvoiceId: row.qualifyingInvoiceId,
    endedAt: row.endedAt,
    ...patch,
  }
}

async function newReferral(referrer: string, referred: string) {
  const row = await insertReferral({
    referrerTenantId: referrer,
    referredTenantId: referred,
    code: 'ABC234',
    capturedVia: 'link',
    capturedAt: new Date('2026-10-01T12:00:00.000Z'),
    status: 'trial',
    ineligibleReason: null,
    checks: {},
  })
  if (!row) throw new Error('insertReferral returned null')
  return row
}

describeIntegration('referrals queries (integration, requires test DB)', () => {
  beforeAll(async () => {
    for (const id of ALL_TENANTS) {
      await db.insert(tenants).values({ id, name: `Referral Test ${id.slice(-4)}`, slug: `referral-test-${id.slice(-4)}` }).onConflictDoNothing()
    }
  })

  beforeEach(async () => {
    await db.delete(referralRewardEvents).where(inArray(referralRewardEvents.referrerTenantId, ALL_TENANTS))
    await db.delete(tenantReferrals).where(inArray(tenantReferrals.referrerTenantId, ALL_TENANTS))
    await db.delete(billingCardFingerprints).where(inArray(billingCardFingerprints.tenantId, ALL_TENANTS))
  })

  it('updateReferralState rejects a stale version after an ABA and accepts the fresh one', async () => {
    const row = await newReferral(REFERRER_A, REFERRED_1)
    const staleVersion = row.version

    // Another writer: counting -> paused -> counting. The status ends up equal, the version does not.
    expect(await updateReferralState(row.id, staleVersion, stateOf(row, { status: 'counting' }))).toBe(true)
    const afterCounting = (await getReferralById(row.id))!
    expect(await updateReferralState(row.id, afterCounting.version, stateOf(afterCounting, { status: 'paused', pausedReason: 'past_due' }))).toBe(true)
    const afterPaused = (await getReferralById(row.id))!
    expect(await updateReferralState(row.id, afterPaused.version, stateOf(afterPaused, { status: 'counting' }))).toBe(true)

    expect(await updateReferralState(row.id, staleVersion, stateOf(row, { status: 'first_paid' }))).toBe(false)

    const fresh = (await getReferralById(row.id))!
    expect(fresh.status).toBe('counting')
    expect(await updateReferralState(row.id, fresh.version, stateOf(fresh, { status: 'first_paid' }))).toBe(true)
  })

  it('bindReferralSubscription keeps the first id', async () => {
    const row = await newReferral(REFERRER_A, REFERRED_1)

    expect(await bindReferralSubscription(row.id, 'sub_first')).toBe('sub_first')
    expect(await bindReferralSubscription(row.id, 'sub_second')).toBe('sub_first')
    expect((await getReferralById(row.id))!.stripeSubscriptionId).toBe('sub_first')
  })

  it('withReferrerRewardLock serialises callbacks of the same referrer', async () => {
    const order: string[] = []
    const firstHolds = deferred()
    const releaseFirst = deferred()
    const first = withReferrerRewardLock(REFERRER_A, async () => {
      order.push('first:start')
      firstHolds.resolve()
      await releaseFirst.promise
      order.push('first:end')
    })
    let second: Promise<void> | undefined
    try {
      await firstHolds.promise // the first callback runs, so it holds the lock
      second = withReferrerRewardLock(REFERRER_A, async () => {
        order.push('second:start')
      })
      await untilAdvisoryLockWaiter() // the second is queued on the lock, not merely late
      expect(order).toEqual(['first:start'])
    } finally {
      releaseFirst.resolve()
    }
    await Promise.all([first, second])

    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('withReferrerRewardLock does not block different referrers', async () => {
    const order: string[] = []
    const aHolds = deferred()
    const releaseA = deferred()
    const first = withReferrerRewardLock(REFERRER_A, async () => {
      order.push('a:start')
      aHolds.resolve()
      await releaseA.promise
      order.push('a:end')
    })
    try {
      await aHolds.promise
      // A is held until released below, so this only resolves if B's lock is independent.
      await withReferrerRewardLock(REFERRER_B, async () => {
        order.push('b:start')
      })
    } finally {
      releaseA.resolve()
    }
    await first

    expect(order).toEqual(['a:start', 'b:start', 'a:end'])
  })

  it('recordCardFingerprints keeps the earliest first_seen_at and the latest last_seen_at', async () => {
    await recordCardFingerprints(REFERRER_A, [
      { fingerprint: 'fp_1', firstSeenAt: new Date('2026-03-01T00:00:00.000Z'), lastSeenAt: new Date('2026-04-01T00:00:00.000Z') },
    ])
    await recordCardFingerprints(REFERRER_A, [
      { fingerprint: 'fp_1', firstSeenAt: new Date('2026-02-01T00:00:00.000Z'), lastSeenAt: new Date('2026-03-15T00:00:00.000Z') },
      { fingerprint: 'fp_1', firstSeenAt: new Date('2026-05-01T00:00:00.000Z'), lastSeenAt: new Date('2026-06-01T00:00:00.000Z') },
    ])

    const [row] = await db.select().from(billingCardFingerprints).where(eq(billingCardFingerprints.tenantId, REFERRER_A))
    expect(row.firstSeenAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(row.lastSeenAt).toEqual(new Date('2026-06-01T00:00:00.000Z'))
  })

  it('listReconcileUnits puts a never-reconciled unit before a reconciled one', async () => {
    const reconciled = await newReferral(REFERRER_A, REFERRED_1)
    await newReferral(REFERRER_B, REFERRED_2)
    await markReferralsReconciled([reconciled.id], new Date('2026-10-20T00:00:00.000Z'))

    const units = (await listReconcileUnits()).filter((u) => ALL_TENANTS.includes(u.referrerTenantId))

    expect(units.map((u) => u.referrerTenantId)).toEqual([REFERRER_B, REFERRER_A])
    expect(units[1].referralIds).toEqual([reconciled.id])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

vi.mock('@/db/queries/referrals', () => ({
  bindReferralSubscription: vi.fn(),
  findReferralByStripeSubscription: vi.fn(),
  getReferralByReferredTenant: vi.fn(),
  getTenantIdByStripeCustomer: vi.fn(),
  getTenantIdByStripeSubscription: vi.fn(),
  isReferrer: vi.fn(),
  listReconcileUnits: vi.fn(),
  markReferralsReconciled: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({ findEarliestSubscriptionId: vi.fn(), retrieveDisputeTarget: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('../lifecycle', () => ({
  refreshReferral: vi.fn(),
  markReferralChargeback: vi.fn(),
  recordTenantCardFingerprints: vi.fn(),
}))
vi.mock('../reward', () => ({ syncReferrerReward: vi.fn() }))

import { handleReferralStripeEvent, reconcileReferrals, type ReferralEventDeps } from '../events'

const ENV = { STRIPE_REFERRER_COUPON_IDS: 'c20,c40,c60,c80,c100' }
const calls: string[] = []

function track<T>(name: string, impl: (...a: never[]) => T) {
  return vi.fn((...a: never[]) => {
    calls.push(name)
    return impl(...a)
  })
}

function makeDeps(over: Record<string, unknown> = {}): ReferralEventDeps {
  return {
    env: ENV,
    refresh: track('refresh', async () => ({
      referralId: 'ref1',
      referrerTenantId: 'referrer1',
      previous: 'trial',
      next: 'counting',
      changed: true,
      rewardReason: 'referral_counting',
    })),
    chargeback: track('chargeback', async () => ({
      referralId: 'ref1',
      referrerTenantId: 'referrer1',
      rewardReason: 'referral_canceled',
    })),
    fingerprints: track('fingerprints', async () => undefined),
    sync: track('sync', async () => ({ skipped: 'not_configured' })),
    findByStripeSub: track('findByStripeSub', async () => null),
    findByReferred: track('findByReferred', async () => null),
    bindSubscription: track('bind', async () => 'sub_new'),
    tenantBySub: track('tenantBySub', async () => 'tenant1'),
    tenantByCustomer: track('tenantByCustomer', async () => 'tenant1'),
    isReferrer: track('isReferrer', async () => false),
    disputeTarget: track('disputeTarget', async () => ({ customerId: 'cus_1', subscriptionId: 'sub_1' })),
    findEarliestSubscription: track('findEarliest', async () => 'sub_new'),
    listUnits: track('listUnits', async () => []),
    markReconciled: track('markReconciled', async () => undefined),
    report: vi.fn(),
    ...over,
  } as unknown as ReferralEventDeps
}

const ev = (type: string, object: Record<string, unknown>) => ({ type, data: { object } }) as unknown as Stripe.Event
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1',
  customer: 'cus_1',
  status: 'paid',
  billing_reason: 'subscription_cycle',
  parent: { subscription_details: { subscription: 'sub_1' } },
  ...over,
})

const referred = { findByStripeSub: track('findByStripeSub', async () => ({ id: 'ref1' })) }
const syncCalls = (d: ReferralEventDeps) => vi.mocked(d.sync).mock.calls

beforeEach(() => {
  calls.length = 0
})

describe('handleReferralStripeEvent', () => {
  it('touches nothing when the referrer coupons are not configured', async () => {
    const d = makeDeps({ env: {} })
    for (const e of [
      ev('invoice.paid', invoice()),
      ev('checkout.session.completed', { metadata: { tenantId: 't' }, mode: 'subscription', subscription: 'sub' }),
      ev('customer.subscription.deleted', { id: 'sub_1' }),
      ev('invoice.created', invoice({ status: 'draft' })),
      ev('charge.dispute.created', { charge: 'ch' }),
    ]) {
      await handleReferralStripeEvent(e, d)
    }
    expect(calls).toEqual([])
  })

  it('invoice.paid on a referred sub: fingerprints, refresh, then sync with the reason', async () => {
    const d = makeDeps(referred)
    await handleReferralStripeEvent(ev('invoice.paid', invoice()), d)

    expect(calls.filter((c) => ['fingerprints', 'refresh', 'sync'].includes(c))).toEqual([
      'fingerprints',
      'refresh',
      'sync',
    ])
    expect(d.fingerprints).toHaveBeenCalledWith('tenant1', 'cus_1')
    expect(syncCalls(d)).toEqual([['referrer1', { reason: 'referral_counting', referralId: 'ref1' }]])
  })

  it('invoice.paid on a referrer’s own sub syncs it with reason subscription', async () => {
    const d = makeDeps({ isReferrer: track('isReferrer', async () => true) })
    await handleReferralStripeEvent(ev('invoice.paid', invoice()), d)
    expect(d.refresh).not.toHaveBeenCalled()
    expect(syncCalls(d)).toEqual([['tenant1', { reason: 'subscription' }]])
  })

  it('a tenant that is referred and a referrer is synced twice: its referrer, then itself', async () => {
    const d = makeDeps({ ...referred, isReferrer: track('isReferrer', async () => true) })
    await handleReferralStripeEvent(ev('invoice.paid', invoice()), d)
    expect(syncCalls(d).map((c) => c[0])).toEqual(['referrer1', 'tenant1'])
  })

  it('falls back to the referred tenant when no referral is bound to the sub', async () => {
    const d = makeDeps({ findByReferred: track('findByReferred', async () => ({ id: 'ref9' })) })
    await handleReferralStripeEvent(ev('invoice.payment_failed', invoice()), d)
    expect(d.refresh).toHaveBeenCalledWith('ref9')
  })

  it('uses reconcile when the refresh implies no reward reason', async () => {
    const d = makeDeps({
      ...referred,
      refresh: track('refresh', async () => ({ referralId: 'ref1', referrerTenantId: 'referrer1', rewardReason: null })),
    })
    await handleReferralStripeEvent(ev('customer.subscription.updated', { id: 'sub_1' }), d)
    expect(syncCalls(d)).toEqual([['referrer1', { reason: 'reconcile', referralId: 'ref1' }]])
  })

  it('skips the sync when the referral vanished', async () => {
    const d = makeDeps({ ...referred, refresh: track('refresh', async () => null) })
    await handleReferralStripeEvent(ev('invoice.paid', invoice()), d)
    expect(d.sync).not.toHaveBeenCalled()
  })

  it('customer.subscription.deleted on a referred sub: refresh then sync', async () => {
    const d = makeDeps(referred)
    await handleReferralStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' }), d)
    expect(d.findByStripeSub).toHaveBeenCalledWith('sub_1')
    expect(calls.filter((c) => c === 'refresh' || c === 'sync')).toEqual(['refresh', 'sync'])
  })

  it('invoice.created cycle draft for a referrer syncs with the draft id', async () => {
    const d = makeDeps({ isReferrer: track('isReferrer', async () => true) })
    await handleReferralStripeEvent(ev('invoice.created', invoice({ status: 'draft' })), d)
    expect(syncCalls(d)).toEqual([['tenant1', { reason: 'invoice_draft', draftInvoiceId: 'in_1' }]])
  })

  it.each([
    ['not a draft', { status: 'open' }],
    ['subscription_create', { status: 'draft', billing_reason: 'subscription_create' }],
  ])('invoice.created that is %s does nothing', async (_n, over) => {
    const d = makeDeps({ isReferrer: track('isReferrer', async () => true) })
    await handleReferralStripeEvent(ev('invoice.created', invoice(over)), d)
    expect(calls).toEqual([])
  })

  const checkout = (over: Record<string, unknown> = {}) =>
    ev('checkout.session.completed', {
      metadata: { tenantId: 'tenant1' },
      mode: 'subscription',
      customer: 'cus_1',
      subscription: 'sub_new',
      ...over,
    })

  it('checkout.session.completed binds the subscription before refreshing', async () => {
    const d = makeDeps({ findByReferred: track('findByReferred', async () => ({ id: 'ref1' })) })
    await handleReferralStripeEvent(checkout(), d)
    expect(d.bindSubscription).toHaveBeenCalledWith('ref1', 'sub_new')
    expect(calls.indexOf('bind')).toBeLessThan(calls.indexOf('refresh'))
    expect(calls.indexOf('refresh')).toBeLessThan(calls.indexOf('sync'))
  })

  it('checkout.session.completed binds the customer’s earliest subscription, not the session’s', async () => {
    // The first sub was canceled and replaced before its own checkout webhook arrived.
    const d = makeDeps({
      findByReferred: track('findByReferred', async () => ({ id: 'ref1' })),
      findEarliestSubscription: track('findEarliest', async () => 'sub_first'),
    })
    await handleReferralStripeEvent(checkout({ subscription: 'sub_replacement' }), d)
    expect(d.findEarliestSubscription).toHaveBeenCalledWith('cus_1')
    expect(d.bindSubscription).toHaveBeenCalledWith('ref1', 'sub_first')
    expect(d.bindSubscription).not.toHaveBeenCalledWith('ref1', 'sub_replacement')
  })

  it('checkout.session.completed without a customer leaves binding to the refresh', async () => {
    const d = makeDeps({ findByReferred: track('findByReferred', async () => ({ id: 'ref1' })) })
    await handleReferralStripeEvent(checkout({ customer: null }), d)
    expect(d.bindSubscription).not.toHaveBeenCalled()
    expect(d.refresh).toHaveBeenCalledWith('ref1')
  })

  it('checkout.session.completed in payment mode skips binding', async () => {
    const d = makeDeps({ findByReferred: track('findByReferred', async () => ({ id: 'ref1' })) })
    await handleReferralStripeEvent(
      ev('checkout.session.completed', { metadata: { tenantId: 'tenant1' }, mode: 'payment', subscription: null }),
      d,
    )
    expect(d.bindSubscription).not.toHaveBeenCalled()
    expect(d.refresh).toHaveBeenCalled()
  })

  it('checkout.session.completed also syncs a referrer’s own subscription', async () => {
    const d = makeDeps({ isReferrer: track('isReferrer', async () => true) })
    await handleReferralStripeEvent(
      ev('checkout.session.completed', { metadata: { tenantId: 'tenant1' }, mode: 'subscription', subscription: 'sub_x' }),
      d,
    )
    expect(syncCalls(d)).toEqual([['tenant1', { reason: 'subscription' }]])
  })

  const dispute = ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' })
  const boundReferral = (stripeSubscriptionId: string | null) => ({
    findByReferred: track('findByReferred', async () => ({ id: 'ref1', stripeSubscriptionId })),
  })

  it('charge.dispute.created on the bound subscription marks the chargeback, then syncs the referrer', async () => {
    const d = makeDeps(boundReferral('sub_1'))
    await handleReferralStripeEvent(dispute, d)
    expect(d.tenantByCustomer).toHaveBeenCalledWith('cus_1')
    expect(d.chargeback).toHaveBeenCalledWith('tenant1')
    expect(syncCalls(d)).toEqual([['referrer1', { reason: 'referral_canceled', referralId: 'ref1' }]])
    expect(calls.indexOf('chargeback')).toBeLessThan(calls.indexOf('sync'))
  })

  it('charge.dispute.created on another subscription of the same customer marks nothing', async () => {
    const d = makeDeps({
      ...boundReferral('sub_1'),
      disputeTarget: track('disputeTarget', async () => ({ customerId: 'cus_1', subscriptionId: 'sub_other' })),
    })
    await handleReferralStripeEvent(dispute, d)
    expect(d.chargeback).not.toHaveBeenCalled()
    expect(d.sync).not.toHaveBeenCalled()
  })

  it('charge.dispute.created whose subscription cannot be resolved reports instead of marking', async () => {
    const d = makeDeps({
      ...boundReferral('sub_1'),
      disputeTarget: track('disputeTarget', async () => ({ customerId: 'cus_1', subscriptionId: null })),
    })
    await handleReferralStripeEvent(dispute, d)
    expect(d.chargeback).not.toHaveBeenCalled()
    expect(d.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: 'referral', step: 'dispute_unresolved' }),
    )
  })

  it('charge.dispute.created on an unbound referral compares with the customer’s earliest subscription', async () => {
    const d = makeDeps({
      ...boundReferral(null),
      findEarliestSubscription: track('findEarliest', async () => 'sub_1'),
    })
    await handleReferralStripeEvent(dispute, d)
    expect(d.findEarliestSubscription).toHaveBeenCalledWith('cus_1')
    expect(d.chargeback).toHaveBeenCalledWith('tenant1')
  })

  it('charge.dispute.created for a tenant without a referral syncs nothing', async () => {
    const d = makeDeps()
    await handleReferralStripeEvent(dispute, d)
    expect(d.chargeback).not.toHaveBeenCalled()
    expect(d.sync).not.toHaveBeenCalled()
  })

  it('propagates a refresh failure so Stripe redelivers', async () => {
    const d = makeDeps({
      ...referred,
      refresh: track('refresh', async () => {
        throw new Error('stripe down')
      }),
    })
    await expect(handleReferralStripeEvent(ev('invoice.paid', invoice()), d)).rejects.toThrow('stripe down')
    expect(d.sync).not.toHaveBeenCalled()
  })

  it('ignores unrelated events', async () => {
    const d = makeDeps()
    await handleReferralStripeEvent(ev('customer.created', { id: 'cus_1' }), d)
    expect(calls).toEqual([])
  })
})

describe('reconcileReferrals', () => {
  const unit = (referrerTenantId: string, referralIds: string[]) => ({ referrerTenantId, referralIds })

  it('is a no-op when not configured', async () => {
    const d = makeDeps({ env: {} })
    await expect(reconcileReferrals({}, d)).resolves.toEqual({ refreshed: 0, synced: 0, failed: 0, skipped: 0 })
    expect(d.listUnits).not.toHaveBeenCalled()
  })

  it('refreshes each referral, syncs each unit and stamps it', async () => {
    const now = new Date('2026-10-21T10:00:00Z')
    const d = makeDeps({
      listUnits: track('listUnits', async () => [unit('r1', ['a', 'b']), unit('r2', [])]),
    })
    const res = await reconcileReferrals({ now }, d)
    expect(res).toEqual({ refreshed: 2, synced: 2, failed: 0, skipped: 0 })
    expect(syncCalls(d)).toEqual([
      ['r1', { reason: 'reconcile' }],
      ['r2', { reason: 'reconcile' }],
    ])
    expect(d.markReconciled).toHaveBeenCalledWith(['a', 'b'], now)
  })

  it('isolates failures: a failed refresh still gets its unit synced and stamped', async () => {
    const d = makeDeps({
      listUnits: track('listUnits', async () => [unit('r1', ['a', 'b']), unit('r2', ['c'])]),
      refresh: track('refresh', async (id: string) => {
        if (id === 'a') throw new Error('boom')
        return null
      }),
      sync: track('sync', async (id: string) => {
        if (id === 'r2') throw new Error('sync boom')
        return { skipped: 'not_configured' }
      }),
    })
    const res = await reconcileReferrals({}, d)
    expect(res).toEqual({ refreshed: 2, synced: 1, failed: 2, skipped: 0 })
    expect(d.report).toHaveBeenCalledTimes(2)
    expect(d.markReconciled).toHaveBeenCalledTimes(2)
  })

  it('counts every unit past the deadline as skipped', async () => {
    const d = makeDeps({ listUnits: track('listUnits', async () => [unit('r1', ['a']), unit('r2', ['b'])]) })
    const res = await reconcileReferrals({ deadlineAt: Date.now() - 1 }, d)
    expect(res).toEqual({ refreshed: 0, synced: 0, failed: 0, skipped: 2 })
    expect(d.sync).not.toHaveBeenCalled()
  })

  it('cuts a big referrer mid-way at the deadline, resumes it later, and still rotates to the others', async () => {
    const ids: Record<string, string[]> = { A: ['a1', 'a2'], B: ['b1'], C: ['c1'] }
    const stamps = new Map<string, number>(Object.values(ids).flat().map((id) => [id, 0]))
    let clock = 1
    const base = makeDeps()
    const listUnits = vi.fn(async () =>
      Object.entries(ids)
        .map(([k, list]) => ({ k, list: [...list].sort((x, y) => stamps.get(x)! - stamps.get(y)!) }))
        .sort((a, b) => stamps.get(a.list[0])! - stamps.get(b.list[0])! || a.k.localeCompare(b.k))
        .map(({ k, list }) => unit(k, list)),
    )
    const markReconciled = vi.fn(async (idList: string[]) => {
      for (const id of idList) stamps.set(id, clock++)
    })
    // The first clock read is before the deadline, every later one after it: one referral per run.
    const nowSpy = vi.spyOn(Date, 'now')
    const runOnce = async () => {
      let reads = 0
      nowSpy.mockImplementation(() => (reads++ === 0 ? 0 : 2_000))
      const deps = { ...base, listUnits, markReconciled, refresh: vi.fn(async () => null), sync: vi.fn(async () => ({ skipped: 'not_configured' })) }
      const res = await reconcileReferrals({ deadlineAt: 1_000 }, deps as never)
      const first = (c: unknown[]) => c[0]
      return { res, refreshed: deps.refresh.mock.calls.map(first), synced: deps.sync.mock.calls.map(first) }
    }

    const r1 = await runOnce()
    expect(r1).toMatchObject({ refreshed: ['a1'], synced: ['A'], res: { skipped: 3 } })
    expect(await runOnce()).toMatchObject({ refreshed: ['a2'], synced: ['A'] })
    expect(await runOnce()).toMatchObject({ refreshed: ['b1'], synced: ['B'] })
    expect(await runOnce()).toMatchObject({ refreshed: ['c1'], synced: ['C'] })
  })
})

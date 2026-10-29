import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/referrals', () => ({
  countCountingReferrals: vi.fn(),
  getReferralSummary: vi.fn(),
  getReferrerBilling: vi.fn(),
  getTenantNames: vi.fn(),
  recordRewardStateIfChanged: vi.fn(),
  withReferrerRewardLock: vi.fn(),
}))
vi.mock('@/db/queries/whatsapp-credits', () => ({ raiseReferralBonus: vi.fn() }))
vi.mock('@/lib/stripe', () => ({
  listOpenCycleDrafts: vi.fn(),
  retrieveInvoiceWithDiscounts: vi.fn(),
  retrieveSubscriptionOrMissing: vi.fn(),
  updateInvoiceDiscounts: vi.fn(),
  updateSubscriptionDiscounts: vi.fn(),
  referrerCouponsMatchTerms: vi.fn(),
}))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('../emails', () => ({ sendReferralRewardEmail: vi.fn() }))

import type { DbExecutor } from '@/db/queries/referrals'
import { percentAt, planReferralDiscounts, syncReferrerReward, type RewardDeps, type SyncTrigger } from '../reward'

const IDS = { 20: 'id20', 40: 'id40', 60: 'id60', 80: 'id80', 100: 'id100' } as const
const ENV = { STRIPE_REFERRER_COUPON_IDS: 'id20,id40,id60,id80,id100' }
const NOW = new Date('2026-10-21T15:00:00.000Z')
const fakeTx = { tx: true } as unknown as DbExecutor

const discount = (id: string, couponId: string, metadata?: Record<string, string>) =>
  ({ id, source: { type: 'coupon', coupon: { id: couponId, metadata: metadata ?? {} } } }) as never
const sub = (over: Record<string, unknown> = {}) =>
  ({
    id: 'sub_1',
    status: 'active',
    discounts: [],
    items: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] },
    ...over,
  }) as never
const yearlySub = (discounts: unknown[] = []) =>
  sub({
    discounts,
    items: { data: [{ price: { recurring: { interval: 'year', interval_count: 1 } } }] },
  })
const draft = (id: string, discounts: unknown[], over: Record<string, unknown> = {}) =>
  ({
    id,
    status: 'draft',
    billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: 'sub_1' } },
    created: Math.floor(NOW.getTime() / 1000),
    discounts,
    ...over,
  }) as never
const billing = (over: Record<string, unknown> = {}) =>
  ({
    tenantId: 'ref1',
    source: 'stripe',
    status: 'active',
    stripeSubscriptionId: 'sub_1',
    stripeCustomerId: 'cus_1',
    currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
    planId: 'p',
    billingInterval: 'month',
    priceCents: 9900,
    whatsappLimit: 500,
    ...over,
  }) as never

function makeDeps(over: Record<string, unknown> = {}) {
  const deps = {
    now: vi.fn(() => NOW),
    env: ENV,
    withLock: vi.fn(async (_id: string, fn: (tx: DbExecutor) => Promise<unknown>) => fn(fakeTx)),
    countCounting: vi.fn().mockResolvedValue(2),
    getBilling: vi.fn().mockResolvedValue(billing()),
    retrieveSubscription: vi.fn().mockResolvedValue(sub()),
    updateSubscriptionDiscounts: vi.fn().mockResolvedValue({}),
    listOpenDrafts: vi.fn().mockResolvedValue([]),
    retrieveInvoice: vi.fn(),
    updateInvoiceDiscounts: vi.fn().mockResolvedValue({}),
    raiseBonus: vi.fn().mockResolvedValue({ bonusCredits: 0 }),
    recordState: vi.fn().mockResolvedValue({ inserted: true, previous: null }),
    notify: vi.fn().mockResolvedValue(undefined),
    getReferral: vi.fn().mockResolvedValue({ id: 'r1', referredName: 'Flor', status: 'counting' }),
    report: vi.fn(),
    tenantNames: vi.fn().mockResolvedValue({ ref1: 'Clínica Mãe' }),
    notifyDiscord: vi.fn().mockResolvedValue(undefined),
    couponsMatchTerms: vi.fn().mockResolvedValue(true),
    ...over,
  }
  return deps
}
type Deps = ReturnType<typeof makeDeps>
const run = (
  deps: Deps,
  trigger: SyncTrigger = { reason: 'referral_counting', referralId: 'r1' },
) =>
  syncReferrerReward('ref1', trigger, deps as unknown as Partial<RewardDeps>)

describe('syncReferrerReward', () => {
  it('is skipped without taking the lock when coupons are not configured', async () => {
    const deps = makeDeps({ env: {} })
    expect(await run(deps)).toEqual({ skipped: 'not_configured' })
    expect(deps.withLock).not.toHaveBeenCalled()
    expect(deps.countCounting).not.toHaveBeenCalled()
    expect(deps.retrieveSubscription).not.toHaveBeenCalled()
    expect(deps.recordState).not.toHaveBeenCalled()
  })

  it('touches nothing and reports when the coupon ids do not match their percents in Stripe', async () => {
    const deps = makeDeps({ couponsMatchTerms: vi.fn().mockResolvedValue(false) })
    expect(await run(deps)).toEqual({ skipped: 'misconfigured' })
    expect(deps.withLock).not.toHaveBeenCalled()
    expect(deps.updateSubscriptionDiscounts).not.toHaveBeenCalled()
    expect(deps.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'referrer_coupons_misconfigured' }))
  })

  it('applies 40% for 2 counting, records the event and notifies after the lock resolved', async () => {
    const order: string[] = []
    const deps = makeDeps({
      withLock: vi.fn(async (_id: string, fn: (tx: DbExecutor) => Promise<unknown>) => {
        const r = await fn(fakeTx)
        order.push('lock-resolved')
        return r
      }) as never,
      notify: vi.fn(async () => {
        order.push('notify')
      }),
    })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [{ coupon: 'id40' }])
    expect(deps.updateSubscriptionDiscounts.mock.calls[0]).toHaveLength(2)
    expect(deps.recordState).toHaveBeenCalledWith(
      expect.objectContaining({ counting: 2, discountPercent: 40, bonusCredits: 0, stripeSubscriptionId: 'sub_1', reason: 'referral_counting', referralId: 'r1' }),
      fakeTx,
    )
    expect(deps.notify).toHaveBeenCalledWith({
      referrerTenantId: 'ref1',
      previous: null,
      current: { discountPercent: 40, bonusCredits: 0, counting: 2 },
      referral: { referredName: 'Flor', nowCounting: true },
    })
    expect(order).toEqual(['lock-resolved', 'notify'])
    expect(result).toMatchObject({ targetPercent: 40, targetCouponId: 'id40', stripeUpdated: true, eventRecorded: true })
  })

  it('passes the lock tx to every DB dep', async () => {
    const deps = makeDeps({ countCounting: vi.fn().mockResolvedValue(7) })
    await run(deps)
    expect(deps.countCounting).toHaveBeenCalledWith('ref1', fakeTx)
    expect(deps.getBilling).toHaveBeenCalledWith('ref1', fakeTx)
    expect(deps.raiseBonus).toHaveBeenCalledWith('ref1', 200, fakeTx)
    expect(deps.recordState.mock.calls[0][1]).toBe(fakeTx)
  })

  it('does nothing when already holding the target coupon', async () => {
    const deps = makeDeps({
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_1', 'id40')] })),
      recordState: vi.fn().mockResolvedValue({ inserted: false, previous: { discountPercent: 40, bonusCredits: 0 } }),
    })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(result).toMatchObject({ stripeUpdated: false, eventRecorded: false })
  })

  it('keeps foreign discounts and puts ours last', async () => {
    const deps = makeDeps({
      countCounting: vi.fn().mockResolvedValue(3),
      retrieveSubscription: vi
        .fn()
        .mockResolvedValue(sub({ discounts: [discount('di_w', 'VOLTA30'), discount('di_r', 'id20')] })),
    })
    await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [{ discount: 'di_w' }, { coupon: 'id60' }])
  })

  it('removes our coupon at 0 counting, keeping only foreign discounts', async () => {
    const deps = makeDeps({
      countCounting: vi.fn().mockResolvedValue(0),
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_r', 'id40')] })),
    })
    await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [])
  })

  it('gives 100% and a 200 credit bonus at 7 counting', async () => {
    const deps = makeDeps({ countCounting: vi.fn().mockResolvedValue(7) })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [{ coupon: 'id100' }])
    expect(deps.raiseBonus).toHaveBeenCalledWith('ref1', 200, fakeTx)
    expect(result).toMatchObject({ bonusTarget: 200 })
  })

  it('gives no bonus on an unlimited plan', async () => {
    const deps = makeDeps({
      countCounting: vi.fn().mockResolvedValue(7),
      getBilling: vi.fn().mockResolvedValue(billing({ whatsappLimit: -1 })),
    })
    const result = await run(deps)
    expect(deps.raiseBonus).not.toHaveBeenCalled()
    expect(result).toMatchObject({ bonusTarget: 0 })
  })

  it('a stale local period end does not drop the coupon or touch the draft', async () => {
    const deps = makeDeps({
      getBilling: vi.fn().mockResolvedValue(billing({ currentPeriodEnd: new Date('2026-10-01T00:00:00Z') })),
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_1', 'id40')] })),
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [discount('di_2', 'id40')])]),
    })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).not.toHaveBeenCalled()
    expect(deps.updateInvoiceDiscounts).not.toHaveBeenCalled()
    expect(result).toMatchObject({ targetPercent: 40, eligible: true })
  })

  it('a yearly subscription loses our coupon, on the sub and the open draft', async () => {
    const deps = makeDeps({
      retrieveSubscription: vi.fn().mockResolvedValue(yearlySub([discount('di_1', 'id40')])),
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [discount('di_2', 'id40')])]),
    })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [])
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledWith('in_1', [])
    expect(deps.recordState).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercent: 0, bonusCredits: 0, stripeSubscriptionId: 'sub_1' }),
      fakeTx,
    )
    expect(result).toMatchObject({ updatable: true, eligible: false })
  })

  it('removes our coupon from a gift row over a live Stripe sub', async () => {
    const deps = makeDeps({
      getBilling: vi.fn().mockResolvedValue(billing({ source: 'gift' })),
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_1', 'id20')] })),
    })
    await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [])
  })

  it.each([
    ['canceled', sub({ status: 'canceled' })],
    ['missing', 'missing'],
  ])('makes no Stripe update when the Stripe sub is %s', async (_name, stripeSub) => {
    const deps = makeDeps({
      getBilling: vi.fn().mockResolvedValue(billing({ status: 'expired' })),
      retrieveSubscription: vi.fn().mockResolvedValue(stripeSub),
    })
    await run(deps)
    expect(deps.updateSubscriptionDiscounts).not.toHaveBeenCalled()
    expect(deps.listOpenDrafts).not.toHaveBeenCalled()
    expect(deps.recordState).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercent: 0, stripeSubscriptionId: null }),
      fakeTx,
    )
  })

  it('judges each draft by its own creation instant after the program end', async () => {
    const end = new Date('2026-10-21T14:00:00.000Z')
    const sec = (d: Date) => Math.floor(d.getTime() / 1000)
    const before = draft('in_before', [discount('di_b', 'id40')], { created: sec(new Date(end.getTime() - 10 * 60_000)) })
    const after = draft('in_after', [discount('di_a', 'id40')], { created: sec(new Date(end.getTime() + 5 * 60_000)) })
    const deps = makeDeps({
      env: { ...ENV, REFERRAL_REWARDS_END_AT: end.toISOString() },
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_1', 'id40')] })),
      listOpenDrafts: vi.fn().mockResolvedValue([before, after]),
    })
    const result = await run(deps)
    expect(deps.updateSubscriptionDiscounts).toHaveBeenCalledWith('sub_1', [])
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledTimes(1)
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledWith('in_after', [])
    expect(deps.raiseBonus).not.toHaveBeenCalled()
    expect(result).toMatchObject({ targetPercent: 0, bonusTarget: 0 })
  })

  it('repairs an open draft when a later referral starts counting', async () => {
    const deps = makeDeps({
      retrieveSubscription: vi.fn().mockResolvedValue(sub({ discounts: [discount('di_1', 'id40')] })),
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [discount('di_2', 'id20')])]),
    })
    const result = await run(deps, { reason: 'referral_counting', referralId: 'r2' })
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledWith('in_1', [{ coupon: 'id40' }])
    expect(result).toMatchObject({ draftsUpdated: ['in_1'] })
  })

  it('retrieves a trigger draft missing from the list and ignores non-cycle / non-draft invoices', async () => {
    const deps = makeDeps({
      retrieveInvoice: vi.fn().mockResolvedValue(draft('in_new', [])),
      listOpenDrafts: vi.fn().mockResolvedValue([
        draft('in_manual', [], { billing_reason: 'manual' }),
        draft('in_open', [], { status: 'open' }),
      ]),
    })
    await run(deps, { reason: 'invoice_draft', referralId: null, draftInvoiceId: 'in_new' })
    expect(deps.retrieveInvoice).toHaveBeenCalledWith('in_new')
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledTimes(1)
    expect(deps.updateInvoiceDiscounts).toHaveBeenCalledWith('in_new', [{ coupon: 'id40' }])
  })

  it('does not retrieve the trigger draft when the list already has it', async () => {
    const deps = makeDeps({
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [])]),
    })
    await run(deps, { reason: 'invoice_draft', draftInvoiceId: 'in_1' })
    expect(deps.retrieveInvoice).not.toHaveBeenCalled()
  })

  it('swallows and reports a not-editable draft, but rethrows other errors', async () => {
    const notEditable = Object.assign(new Error('This invoice is no longer editable'), { code: 'invoice_not_editable' })
    const swallow = makeDeps({
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [])]),
      updateInvoiceDiscounts: vi.fn().mockRejectedValue(notEditable),
    })
    await expect(run(swallow)).resolves.toMatchObject({ draftsUpdated: [] })
    expect(swallow.report).toHaveBeenCalledWith(notEditable, expect.objectContaining({ step: 'draft_not_editable' }))

    const boom = makeDeps({
      listOpenDrafts: vi.fn().mockResolvedValue([draft('in_1', [])]),
      updateInvoiceDiscounts: vi.fn().mockRejectedValue(new Error('stripe down')),
    })
    await expect(run(boom)).rejects.toThrow('stripe down')
  })

  it('20 → 40 → 20 issues three subscription updates, none with an idempotency key', async () => {
    const deps = makeDeps()
    const holding: Array<string | null> = [null, 'id20', 'id40']
    for (const [i, n] of [1, 2, 1].entries()) {
      deps.countCounting.mockResolvedValue(n)
      const held = holding[i]
      deps.retrieveSubscription.mockResolvedValue(sub({ discounts: held ? [discount('di', held)] : [] }))
      await run(deps)
    }
    expect(deps.updateSubscriptionDiscounts.mock.calls).toEqual([
      ['sub_1', [{ coupon: 'id20' }]],
      ['sub_1', [{ coupon: 'id40' }]],
      ['sub_1', [{ coupon: 'id20' }]],
    ])
  })

  describe('serialization under the reward lock', () => {
    function mutexLock() {
      const tails = new Map<string, Promise<unknown>>()
      return async <T,>(id: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
        const prev = tails.get(id) ?? Promise.resolve()
        const run = prev.then(() => fn(fakeTx))
        tails.set(id, run.catch(() => undefined))
        return run
      }
    }
    const flush = () => new Promise((r) => setTimeout(r, 0))

    it('a second sync waits for the first, so the stale 40% never lands after 60%', async () => {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const applied: unknown[] = []
      const counts = [2, 3]
      const recordA = vi.fn().mockResolvedValue({ inserted: false, previous: null })
      let calls = 0
      const deps = makeDeps({
        withLock: mutexLock() as never,
        countCounting: vi.fn(async () => counts[calls++]),
        updateSubscriptionDiscounts: vi.fn(async (_id: string, discounts: unknown[]) => {
          if (applied.length === 0) await gate
          applied.push(discounts)
        }),
        recordState: recordA,
      })
      const a = run(deps)
      const b = run(deps)
      await flush()
      expect(deps.countCounting).toHaveBeenCalledTimes(1)
      expect(recordA).not.toHaveBeenCalled()
      release()
      await Promise.all([a, b])
      expect(deps.countCounting).toHaveBeenCalledTimes(2)
      expect(applied).toEqual([[{ coupon: 'id40' }], [{ coupon: 'id60' }]])
    })

    it('reversed order: the sync that reads last applies last', async () => {
      const applied: unknown[] = []
      const counts = [3, 2]
      let calls = 0
      const deps = makeDeps({
        withLock: mutexLock() as never,
        countCounting: vi.fn(async () => counts[calls++]),
        updateSubscriptionDiscounts: vi.fn(async (_id: string, discounts: unknown[]) => {
          applied.push(discounts)
        }),
      })
      await Promise.all([run(deps), run(deps)])
      expect(applied).toEqual([[{ coupon: 'id60' }], [{ coupon: 'id40' }]])
    })
  })

  it('rejects without recording or notifying when the subscription update throws', async () => {
    const deps = makeDeps({ updateSubscriptionDiscounts: vi.fn().mockRejectedValue(new Error('boom')) })
    await expect(run(deps)).rejects.toThrow('boom')
    expect(deps.recordState).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('resolves and reports when notify throws', async () => {
    const err = new Error('mail down')
    const deps = makeDeps({ notify: vi.fn().mockRejectedValue(err) })
    await expect(run(deps)).resolves.toMatchObject({ eventRecorded: true })
    expect(deps.report).toHaveBeenCalledWith(err, expect.objectContaining({ area: 'referral' }))
  })

  it('does not notify when only the subscription id changed', async () => {
    const deps = makeDeps({
      recordState: vi
        .fn()
        .mockResolvedValue({ inserted: true, previous: { counting: 2, discountPercent: 40, bonusCredits: 0 } }),
    })
    await run(deps)
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.notifyDiscord).not.toHaveBeenCalled()
  })

  it('posts the reward change to Discord once, after the lock resolved', async () => {
    const order: string[] = []
    const deps = makeDeps({
      withLock: vi.fn(async (_id: string, fn: (tx: DbExecutor) => Promise<unknown>) => {
        const r = await fn(fakeTx)
        order.push('lock-resolved')
        return r
      }) as never,
      recordState: vi
        .fn()
        .mockResolvedValue({ inserted: true, previous: { counting: 1, discountPercent: 20, bonusCredits: 0 } }),
      notifyDiscord: vi.fn(async () => {
        order.push('discord')
      }),
    })
    await run(deps)
    expect(deps.notifyDiscord).toHaveBeenCalledTimes(1)
    expect(deps.notifyDiscord).toHaveBeenCalledWith({
      kind: 'referral.reward_changed',
      referrerName: 'Clínica Mãe',
      referrerTenantId: 'ref1',
      previous: { counting: 1, discountPercent: 20, bonusCredits: 0 },
      current: { counting: 2, discountPercent: 40, bonusCredits: 0 },
    })
    expect(order).toEqual(['lock-resolved', 'discord'])
  })

  it('still syncs with the enrollment switch off', async () => {
    const deps = makeDeps({ env: { ...ENV, REFERRAL_ENROLLMENT_ENABLED: 'false' } })
    const result = await run(deps)
    expect(result).toMatchObject({ targetPercent: 40, stripeUpdated: true })
  })
})

describe('planReferralDiscounts', () => {
  it('keeps string ids as { discount } and drops deleted discounts', () => {
    const plan = planReferralDiscounts(
      ['di_str', { id: 'di_gone', deleted: true } as never, discount('di_r', 'id20')],
      'id40',
      IDS,
    )
    expect(plan.discounts).toEqual([{ discount: 'di_str' }, { coupon: 'id40' }])
    expect(plan.currentReferralCouponId).toBe('id20')
  })

  it('recognises our coupon by metadata even with an unknown id', () => {
    const plan = planReferralDiscounts([discount('di_x', 'old_coupon', { purpose: 'referral_reward' })], 'id20', IDS)
    expect(plan).toEqual({ changed: true, discounts: [{ coupon: 'id20' }], currentReferralCouponId: 'old_coupon' })
  })

  it('reports no change for an unchanged target', () => {
    const plan = planReferralDiscounts([discount('di_1', 'id40')], 'id40', IDS)
    expect(plan.changed).toBe(false)
    expect(planReferralDiscounts([], null, IDS).changed).toBe(false)
  })
})

describe('percentAt', () => {
  const env = { ...ENV, REFERRAL_REWARDS_END_AT: '2026-10-21T14:00:00.000Z' }
  it('is count-based before the end instant and 0 from it', () => {
    expect(percentAt(new Date('2026-10-21T13:59:59.000Z'), { eligible: true, counting: 3 }, env)).toBe(60)
    expect(percentAt(new Date('2026-10-21T14:00:00.000Z'), { eligible: true, counting: 3 }, env)).toBe(0)
  })
  it('is 0 when ineligible', () => {
    expect(percentAt(NOW, { eligible: false, counting: 3 }, ENV)).toBe(0)
  })
})

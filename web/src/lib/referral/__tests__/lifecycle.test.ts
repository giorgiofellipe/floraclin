import { describe, expect, it, vi, type Mocked } from 'vitest'

vi.mock('@/db/queries/referrals', () => ({
  bindReferralSubscription: vi.fn(),
  getReferralByReferredTenant: vi.fn(),
  getReferralContext: vi.fn(),
  getTenantNames: vi.fn(),
  loadCandidateTenants: vi.fn(),
  loadTenantSignals: vi.fn(),
  markReferralIneligible: vi.fn(),
  recordCardFingerprints: vi.fn(),
  updateReferralState: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({
  findEarliestSubscriptionId: vi.fn(),
  listCustomerCardSightings: vi.fn(),
  listPaidSubscriptionInvoices: vi.fn(),
  retrieveSubscriptionOrMissing: vi.fn(),
}))

import type { ReferralContext, TenantReferral } from '@/db/queries/referrals'
import type { PaidInvoiceSummary } from '@/lib/stripe'
import { runEligibilityChecks } from '../eligibility'
import {
  buildStripeSnapshotPart,
  markReferralChargeback,
  refreshReferral,
  rewardReasonFor,
  type LifecycleDeps,
} from '../lifecycle'
import type { CandidateTenant, ReferralStatus, TenantSignals } from '../types'

const NOW = new Date('2026-11-20T15:00:00.000Z')
const SIGNUP = new Date('2026-09-01T15:00:00.000Z')
const T1 = new Date('2026-09-15T15:00:00.000Z')
const T2 = new Date('2026-10-15T15:00:00.000Z')

const referral = (o: Partial<TenantReferral> = {}): TenantReferral =>
  ({
    id: 'ref_1',
    referrerTenantId: 'referrer',
    referredTenantId: 'referred',
    status: 'trial',
    pausedReason: null,
    ineligibleReason: null,
    stripeSubscriptionId: null,
    firstPaidAt: null,
    qualifiedAt: null,
    qualifyingInvoiceId: null,
    endedAt: null,
    version: 3,
    checks: {},
    ...o,
  }) as TenantReferral

const context = (o: Partial<Omit<ReferralContext, 'referral'>> & { referral?: Partial<TenantReferral> } = {}): ReferralContext => ({
  referral: referral(o.referral),
  referredDeleted: false,
  referredSignupAt: SIGNUP,
  referredSub: {
    source: 'stripe',
    status: 'active',
    stripeSubscriptionId: 'sub_cur',
    stripeCustomerId: 'cus_referred',
    currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
  },
  referrerCustomerId: 'cus_referrer',
  ...('referredSub' in o ? { referredSub: o.referredSub } : {}),
  ...('referredSignupAt' in o ? { referredSignupAt: o.referredSignupAt } : {}),
  ...('referrerCustomerId' in o ? { referrerCustomerId: o.referrerCustomerId } : {}),
})

const stripeSub = (o: Record<string, unknown> = {}) =>
  ({
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] },
    ...o,
  }) as never

const inv = (id: string, reason: string, amountPaid: number, paidAt: Date): PaidInvoiceSummary => ({
  id,
  billingReason: reason,
  amountPaid,
  paidAt,
})
const create = inv('in_1', 'subscription_create', 9900, T1)
const cycle = inv('in_2', 'subscription_cycle', 9900, T2)

const signals = (tenantId: string, o: Partial<TenantSignals> = {}): TenantSignals => ({
  tenantId,
  ownerEmails: [`owner@${tenantId}.example`],
  phones: [],
  registries: [],
  userIds: [tenantId],
  cardFingerprints: [],
  ...o,
})

function makeDeps(o: Partial<LifecycleDeps> & { ctx?: ReferralContext } = {}) {
  const { ctx = context(), ...rest } = o
  const deps = {
    now: () => NOW,
    getContext: vi.fn(async () => ctx),
    retrieveSubscription: vi.fn(async () => stripeSub()),
    listPaidInvoices: vi.fn(async () => [create]),
    listCardSightings: vi.fn(async () => []),
    findEarliestSubscription: vi.fn(async () => null),
    bindSubscription: vi.fn(async (_id: string, subId: string) => subId),
    recordCardFingerprints: vi.fn(async () => {}),
    loadSignals: vi.fn(async (id: string) => signals(id)),
    loadCandidates: vi.fn(async () => [] as CandidateTenant[]),
    runChecks: vi.fn(runEligibilityChecks),
    saveState: vi.fn(async () => true),
    findByReferredTenant: vi.fn(async () => referral({ status: 'counting' })),
    markIneligible: vi.fn(async () => referral({ status: 'ineligible', ineligibleReason: 'chargeback' })),
    tenantNames: vi.fn(async () => ({ referrer: 'Clínica Mãe', referred: 'Clínica Filha' })),
    notifyDiscord: vi.fn(async () => {}),
    report: vi.fn(),
    ...rest,
  } satisfies LifecycleDeps
  return deps as Mocked<LifecycleDeps> & typeof deps
}

const countingCtx = (extra: Partial<TenantReferral> = {}) =>
  context({
    referral: {
      status: 'counting',
      stripeSubscriptionId: 'sub_1',
      firstPaidAt: T1,
      qualifiedAt: T2,
      qualifyingInvoiceId: 'in_2',
      ...extra,
    },
  })

describe('refreshReferral: trial', () => {
  it('saves trial_ended for an expired trial row, then nothing on a second run', async () => {
    const expired = context({
      referredSub: {
        source: 'trial',
        status: 'trialing',
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
      },
    })
    const deps = makeDeps({ ctx: expired })
    const first = await refreshReferral('ref_1', deps)
    expect(first).toMatchObject({ previous: 'trial', next: 'trial_ended', changed: true, rewardReason: null })
    expect(deps.saveState).toHaveBeenCalledTimes(1)

    const ended = makeDeps({ ctx: context({ ...expired, referral: { status: 'trial_ended' } }) })
    const second = await refreshReferral('ref_1', ended)
    expect(second?.changed).toBe(false)
    expect(ended.saveState).not.toHaveBeenCalled()
    expect(ended.notifyDiscord).not.toHaveBeenCalled()
  })

  it('returns null when the context is missing', async () => {
    const deps = makeDeps({ getContext: vi.fn(async () => null) })
    expect(await refreshReferral('nope', deps)).toBeNull()
  })

  it('makes no Stripe call for a terminal status', async () => {
    const deps = makeDeps({ ctx: context({ referral: { status: 'canceled', stripeSubscriptionId: 'sub_1' } }) })
    const res = await refreshReferral('ref_1', deps)
    expect(res).toMatchObject({ previous: 'canceled', next: 'canceled', changed: false })
    expect(deps.retrieveSubscription).not.toHaveBeenCalled()
    expect(deps.listPaidInvoices).not.toHaveBeenCalled()
    expect(deps.findEarliestSubscription).not.toHaveBeenCalled()
  })
})

describe('refreshReferral: qualification', () => {
  it('moves to first_paid on a subscription_create invoice and stamps the subscription id', async () => {
    const deps = makeDeps({ ctx: context({ referral: { stripeSubscriptionId: 'sub_1' } }) })
    const res = await refreshReferral('ref_1', deps)
    expect(res).toMatchObject({ next: 'first_paid', rewardReason: null })
    expect(deps.saveState).toHaveBeenCalledWith(
      'ref_1',
      3,
      expect.objectContaining({ status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 }),
      undefined,
    )
    expect(deps.runChecks).not.toHaveBeenCalled()
  })

  it('counts on a paid subscription_cycle invoice with clean signals and records both customers cards', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, cycle]),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res).toMatchObject({ previous: 'first_paid', next: 'counting', rewardReason: 'referral_counting' })
    expect(deps.listCardSightings).toHaveBeenCalledWith('cus_referred')
    expect(deps.listCardSightings).toHaveBeenCalledWith('cus_referrer')
    expect(deps.recordCardFingerprints).toHaveBeenCalledWith('referred', [])
    expect(deps.recordCardFingerprints).toHaveBeenCalledWith('referrer', [])
    expect(deps.saveState).toHaveBeenCalledWith(
      'ref_1',
      3,
      expect.objectContaining({ status: 'counting', qualifiedAt: T2, qualifyingInvoiceId: 'in_2' }),
      { atQualification: { selfReferral: [], notNew: [] } },
    )
  })

  it('is ineligible/self_referral when the referrer shares a card fingerprint', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, cycle]),
      loadSignals: vi.fn(async (id: string) => signals(id, { cardFingerprints: ['fp_same'] })),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res).toMatchObject({ next: 'ineligible', rewardReason: null })
    const [, , next, checks] = deps.saveState.mock.calls[0] as unknown as [string, number, { ineligibleReason: string }, { atQualification: { selfReferral: string[] } }]
    expect(next.ineligibleReason).toBe('self_referral')
    expect(checks.atQualification.selfReferral).toContain('card')
  })

  it('does not qualify on a zero-amount cycle invoice', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, inv('in_2', 'subscription_cycle', 0, T2)]),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res?.changed).toBe(false)
    expect(deps.runChecks).not.toHaveBeenCalled()
  })

  it('does not qualify on a subscription_update (proration) invoice', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, inv('in_2', 'subscription_update', 5000, T2)]),
    })
    expect((await refreshReferral('ref_1', deps))?.changed).toBe(false)
  })

  it('runs checks at the qualification stage; a phone shared with a third tenant is not enough', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, cycle]),
      loadSignals: vi.fn(async (id: string) => signals(id, { phones: id === 'referrer' ? [] : ['5541999990000'] })),
      loadCandidates: vi.fn(async () => [
        {
          ...signals('third', { phones: ['5541999990000'] }),
          subscriptionCreatedAt: new Date('2026-06-01T00:00:00Z'),
          subscriptionEndsAt: new Date('2026-08-01T00:00:00Z'),
          cards: [],
        },
      ]),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(deps.runChecks).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'qualification', referredSignupAt: SIGNUP }),
      expect.anything(),
    )
    expect(res?.next).toBe('counting')
  })

  it('a card of the referred customer seen on a third tenant 2 months before signup is not_new', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      listPaidInvoices: vi.fn(async () => [create, cycle]),
      loadSignals: vi.fn(async (id: string) => signals(id, { cardFingerprints: id === 'referred' ? ['fp_old'] : [] })),
      loadCandidates: vi.fn(async () => [
        {
          ...signals('third'),
          subscriptionCreatedAt: new Date('2026-05-01T00:00:00Z'),
          subscriptionEndsAt: new Date('2026-07-01T00:00:00Z'),
          cards: [
            {
              fingerprint: 'fp_old',
              firstSeenAt: new Date('2026-06-01T00:00:00Z'),
              lastSeenAt: new Date('2026-07-01T00:00:00Z'),
            },
          ],
        },
      ]),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res?.next).toBe('ineligible')
    const [, , next] = deps.saveState.mock.calls[0] as unknown as [string, number, { ineligibleReason: string }]
    expect(next.ineligibleReason).toBe('not_new')
  })
})

describe('refreshReferral: Stripe state', () => {
  it('marks canceled when Stripe says the subscription is missing', async () => {
    const deps = makeDeps({
      ctx: context({ referral: { status: 'first_paid', stripeSubscriptionId: 'sub_1', firstPaidAt: T1 } }),
      retrieveSubscription: vi.fn(async () => 'missing' as const),
    })
    expect(await refreshReferral('ref_1', deps)).toMatchObject({ next: 'canceled', rewardReason: null })
  })

  it('pauses a counting referral when Stripe is past_due', async () => {
    const deps = makeDeps({
      ctx: countingCtx(),
      retrieveSubscription: vi.fn(async () => stripeSub({ status: 'past_due' })),
      listPaidInvoices: vi.fn(async () => [create, cycle]),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res).toMatchObject({ previous: 'counting', next: 'paused', rewardReason: 'referral_paused' })
    expect(deps.saveState).toHaveBeenCalledWith(
      'ref_1',
      3,
      expect.objectContaining({ status: 'paused', pausedReason: 'past_due' }),
      undefined,
    )
    expect(deps.notifyDiscord).toHaveBeenCalledTimes(1)
    expect(deps.notifyDiscord).toHaveBeenCalledWith({
      kind: 'referral.status_changed',
      referrerName: 'Clínica Mãe',
      referrerTenantId: 'referrer',
      referredName: 'Clínica Filha',
      referredTenantId: 'referred',
      from: { status: 'counting', pausedReason: null, ineligibleReason: null },
      to: { status: 'paused', pausedReason: 'past_due', ineligibleReason: null },
      note: null,
    })
  })

  it('persisted firstPaidAt/qualifiedAt carry a counting referral when the invoice list is empty', async () => {
    const deps = makeDeps({
      ctx: countingCtx(),
      retrieveSubscription: vi.fn(async () => stripeSub({ status: 'past_due' })),
      listPaidInvoices: vi.fn(async () => []),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(res?.next).toBe('paused')
    expect(deps.saveState).toHaveBeenCalledWith(
      'ref_1',
      3,
      expect.objectContaining({ status: 'paused', pausedReason: 'past_due' }),
      undefined,
    )
  })
})

describe('refreshReferral: optimistic writes', () => {
  const pausedSetup = () => ({
    retrieveSubscription: vi.fn(async () => stripeSub({ status: 'past_due' })),
    listPaidInvoices: vi.fn(async () => [create, cycle]),
  })

  it('retries once with a freshly loaded context and its new version', async () => {
    const getContext = vi
      .fn()
      .mockResolvedValueOnce(countingCtx({ version: 3 }))
      .mockResolvedValueOnce(countingCtx({ version: 5 }))
    const saveState = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const deps = makeDeps({ getContext, saveState, ...pausedSetup() })
    const res = await refreshReferral('ref_1', deps)
    expect(saveState.mock.calls.map((c) => c[1])).toEqual([3, 5])
    expect(res).toMatchObject({ next: 'paused', changed: true })
  })

  it('does not try a third time after two losses and reports changed:false', async () => {
    const getContext = vi.fn(async () => countingCtx())
    const saveState = vi.fn(async () => false)
    const deps = makeDeps({ getContext, saveState, ...pausedSetup() })
    const res = await refreshReferral('ref_1', deps)
    expect(saveState).toHaveBeenCalledTimes(2)
    expect(res).toMatchObject({ previous: 'counting', next: 'counting', changed: false, rewardReason: null })
  })
})

describe('refreshReferral: first-subscription binding', () => {
  const unbound = (o: Partial<ReferralContext> = {}) =>
    context({
      referral: { status: 'trial', stripeSubscriptionId: null },
      referredSub: {
        source: 'stripe',
        status: 'active',
        stripeSubscriptionId: 'sub_2',
        stripeCustomerId: 'cus_referred',
        currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
      },
      ...o,
    })

  it('binds the customers earliest subscription, never the tenant rows current one', async () => {
    const deps = makeDeps({
      ctx: unbound(),
      findEarliestSubscription: vi.fn(async () => 'sub_1'),
      retrieveSubscription: vi.fn(async (id: string) => stripeSub({ id, status: 'canceled' })),
      listPaidInvoices: vi.fn(async () => []),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(deps.bindSubscription).toHaveBeenCalledWith('ref_1', 'sub_1')
    expect(deps.retrieveSubscription).toHaveBeenCalledWith('sub_1')
    expect(deps.retrieveSubscription).not.toHaveBeenCalledWith('sub_2')
    expect(res?.next).toBe('canceled')
  })

  it('uses the already bound id when bindSubscription returns another one', async () => {
    const deps = makeDeps({
      ctx: unbound(),
      findEarliestSubscription: vi.fn(async () => 'sub_1'),
      bindSubscription: vi.fn(async () => 'sub_0'),
      listPaidInvoices: vi.fn(async () => [create]),
    })
    await refreshReferral('ref_1', deps)
    expect(deps.retrieveSubscription).toHaveBeenCalledWith('sub_0')
    expect(deps.listPaidInvoices).toHaveBeenCalledWith('sub_0')
  })

  it('does not bind without a customer and falls back to the trial logic', async () => {
    const deps = makeDeps({
      ctx: unbound({
        referredSub: {
          source: 'trial',
          status: 'trialing',
          stripeSubscriptionId: 'sub_2',
          stripeCustomerId: null,
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
        },
      }),
    })
    const res = await refreshReferral('ref_1', deps)
    expect(deps.findEarliestSubscription).not.toHaveBeenCalled()
    expect(deps.bindSubscription).not.toHaveBeenCalled()
    expect(deps.retrieveSubscription).not.toHaveBeenCalled()
    expect(res?.changed).toBe(false)
  })
})

describe('markReferralChargeback', () => {
  it('returns referral_canceled for a counting referral', async () => {
    const deps = makeDeps()
    const res = await markReferralChargeback('referred', deps)
    expect(deps.markIneligible).toHaveBeenCalledWith('ref_1', 'chargeback')
    expect(res).toMatchObject({ previous: 'counting', next: 'ineligible', changed: true, rewardReason: 'referral_canceled' })
    expect(deps.notifyDiscord).toHaveBeenCalledTimes(1)
    expect(deps.notifyDiscord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'referral.status_changed',
        from: { status: 'counting', pausedReason: null, ineligibleReason: null },
        to: { status: 'ineligible', pausedReason: null, ineligibleReason: 'chargeback' },
      }),
    )
  })

  it('returns null when the tenant was not referred', async () => {
    const deps = makeDeps({ findByReferredTenant: vi.fn(async () => null) })
    expect(await markReferralChargeback('x', deps)).toBeNull()
  })

  it('is a no-op for an already ineligible referral', async () => {
    const deps = makeDeps({ findByReferredTenant: vi.fn(async () => referral({ status: 'ineligible' })) })
    const res = await markReferralChargeback('referred', deps)
    expect(res?.changed).toBe(false)
    expect(deps.markIneligible).not.toHaveBeenCalled()
    expect(deps.notifyDiscord).not.toHaveBeenCalled()
  })

  it('needs no reward sync when the referral was only first_paid', async () => {
    const deps = makeDeps({ findByReferredTenant: vi.fn(async () => referral({ status: 'first_paid' })) })
    expect((await markReferralChargeback('referred', deps))?.rewardReason).toBeNull()
  })
})

describe('buildStripeSnapshotPart', () => {
  it('derives status, monthly, earliest paid and the earliest qualifying cycle invoice', () => {
    const later = inv('in_3', 'subscription_cycle', 9900, new Date('2026-11-15T00:00:00Z'))
    const part = buildStripeSnapshotPart(stripeSub({ cancel_at_period_end: true }), 'sub_1', [later, cycle, create])
    expect(part).toEqual({
      subscriptionId: 'sub_1',
      status: 'active',
      cancelAtPeriodEnd: true,
      monthly: true,
      firstPaidAt: T1,
      qualifyingInvoice: { id: 'in_2', paidAt: T2 },
    })
  })

  it('reports a yearly price as not monthly', () => {
    const yearly = stripeSub({ items: { data: [{ price: { recurring: { interval: 'year', interval_count: 1 } } }] } })
    expect(buildStripeSnapshotPart(yearly, 'sub_1', []).monthly).toBe(false)
  })

  it('maps a missing subscription', () => {
    expect(buildStripeSnapshotPart('missing', 'sub_1', [create])).toMatchObject({
      status: 'missing',
      monthly: false,
      cancelAtPeriodEnd: false,
      firstPaidAt: T1,
    })
  })

  it('ignores unpaid-dated invoices and zero or non-cycle ones for qualification', () => {
    const part = buildStripeSnapshotPart(stripeSub(), 'sub_1', [
      { id: 'a', billingReason: 'subscription_cycle', amountPaid: 9900, paidAt: null },
      inv('b', 'subscription_cycle', 0, T2),
      inv('c', 'manual', 9900, T2),
    ])
    expect(part.qualifyingInvoice).toBeNull()
    expect(part.firstPaidAt).toEqual(T2)
  })
})

describe('rewardReasonFor', () => {
  const cases: Array<[ReferralStatus, ReferralStatus, ReturnType<typeof rewardReasonFor>]> = [
    ['first_paid', 'counting', 'referral_counting'],
    ['paused', 'counting', 'referral_counting'],
    ['counting', 'paused', 'referral_paused'],
    ['counting', 'first_paid', 'referral_paused'],
    ['counting', 'canceled', 'referral_canceled'],
    ['paused', 'canceled', 'referral_canceled'],
    ['counting', 'ineligible', 'referral_canceled'],
    ['paused', 'ineligible', 'referral_canceled'],
    ['trial', 'first_paid', null],
    ['trial', 'trial_ended', null],
    ['first_paid', 'canceled', null],
    ['paused', 'first_paid', null],
    ['counting', 'counting', null],
  ]
  it.each(cases)('%s → %s = %s', (prev, next, expected) => {
    expect(rewardReasonFor(prev, next)).toBe(expected)
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/queries/referrals', () => ({
  getReferralAttribution: vi.fn(),
  loadCandidateTenants: vi.fn(),
  loadTenantSignals: vi.fn(),
  markReferralIneligible: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({ checkPromotionCode: vi.fn(), customerHasPriorPurchase: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))

import { chooseCheckoutDiscount, getValidatedReferralOffer, publicReferralOffer, type ReferralOfferDeps, type ReferralOfferRow } from '../offer'
import type { PromotionCodeTerms } from '@/lib/stripe'

const NOW = new Date('2026-10-21T13:00:00.000Z')
const SIGNUP = new Date('2026-10-10T13:00:00.000Z')
const ENV = {
  REFERRAL_ENROLLMENT_ENABLED: 'true',
  STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_ref',
  STRIPE_REFERRER_COUPON_IDS: 'c20,c40,c60,c80,c100',
}
const ROW: ReferralOfferRow = {
  tenantId: 't1',
  source: 'trial',
  firstPaidAt: null,
  stripeSubscriptionId: null,
  stripeCustomerId: null,
}
const ATTRIBUTION = {
  id: 'ref-1',
  status: 'trial' as const,
  stripeSubscriptionId: null,
  referrerTenantId: 't9',
  referrerName: 'Clínica Bela',
}
const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 9900, billingInterval: 'month', stripePriceId: 'price_starter' },
  { slug: 'pro-anual', name: 'Pro Anual', priceCents: 199000, billingInterval: 'year', stripePriceId: 'price_year' },
  { slug: 'pro', name: 'Pro', priceCents: 19900, billingInterval: 'month', stripePriceId: 'price_pro' },
]
const TERMS: PromotionCodeTerms = {
  percentOff: 20,
  amountOffCents: null,
  duration: 'repeating',
  durationInMonths: 2,
  productIds: null,
  firstTimeTransaction: true,
  minimumAmountCents: null,
}

function deps(over: Partial<Record<keyof ReferralOfferDeps, unknown>> = {}) {
  return {
    attribution: vi.fn(async () => ATTRIBUTION),
    signupAt: vi.fn(async () => SIGNUP),
    runChecks: vi.fn(async () => ({ selfReferral: [], notNew: [], verdict: null })),
    loadSignals: vi.fn(),
    loadCandidates: vi.fn(),
    markIneligible: vi.fn(async () => null),
    announce: vi.fn(async () => undefined),
    check: vi.fn(async () => TERMS),
    priorPurchase: vi.fn(async () => false),
    report: vi.fn(),
    ...over,
  } as unknown as ReferralOfferDeps & { [K in keyof ReferralOfferDeps]: ReturnType<typeof vi.fn> }
}

const run = (d: ReferralOfferDeps, row = ROW, plans = PLANS, opts?: Parameters<typeof getValidatedReferralOffer>[5]) =>
  getValidatedReferralOffer(row, plans, NOW, ENV, d, opts)

describe('getValidatedReferralOffer', () => {
  it('builds the offer from the coupon for monthly plans and runs the checkout identity check', async () => {
    const d = deps()
    const offer = await run(d)
    expect(offer).toMatchObject({
      kind: 'referral',
      promotionCodeId: 'promo_ref',
      referralId: 'ref-1',
      referrerName: 'Clínica Bela',
      label: '20% de desconto nos 2 primeiros meses',
      planSlugs: ['starter', 'pro'],
    })
    expect(d.runChecks).toHaveBeenCalledWith(
      { referredTenantId: 't1', referrerTenantId: 't9', referredSignupAt: SIGNUP, stage: 'checkout' },
      { loadSignals: d.loadSignals, loadCandidates: d.loadCandidates },
    )
    expect(d.check).toHaveBeenCalledWith('promo_ref', NOW)
  })

  it('makes no dependency call with the switch off', async () => {
    const d = deps()
    expect(await getValidatedReferralOffer(ROW, PLANS, NOW, {}, d)).toBeNull()
    for (const fn of Object.values(d)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(['self_referral', 'not_new'] as const)('marks the referral ineligible on a %s verdict and skips Stripe', async (verdict) => {
    const res = { selfReferral: [], notNew: [], verdict }
    const d = deps({ runChecks: vi.fn(async () => res) })
    expect(await run(d)).toBeNull()
    expect(d.markIneligible).toHaveBeenCalledWith('ref-1', verdict, undefined, { atCheckout: res })
    expect(d.check).not.toHaveBeenCalled()
  })

  it('announces the checkout-time ineligible mark once, from the previous status', async () => {
    const res = { selfReferral: ['email_domain'], notNew: [], verdict: 'self_referral' as const }
    const updated = { id: 'ref-1', status: 'ineligible', ineligibleReason: 'self_referral', pausedReason: null }
    const d = deps({ runChecks: vi.fn(async () => res), markIneligible: vi.fn(async () => updated) })
    await run(d)
    expect(d.announce).toHaveBeenCalledTimes(1)
    expect(d.announce).toHaveBeenCalledWith(expect.objectContaining({ status: 'trial', ineligibleReason: null }), updated)
  })

  it('fails closed and reports when the checks throw', async () => {
    const d = deps({ runChecks: vi.fn(async () => { throw new Error('db down') }) })
    expect(await run(d)).toBeNull()
    expect(d.report).toHaveBeenCalledTimes(1)
    expect(d.markIneligible).not.toHaveBeenCalled()
    expect(d.check).not.toHaveBeenCalled()
  })

  it('uses a pre-fetched attribution without reading it again', async () => {
    const d = deps()
    expect(await run(d, ROW, PLANS, { attribution: ATTRIBUTION })).not.toBeNull()
    expect(d.attribution).not.toHaveBeenCalled()
  })

  it('gives nothing to a clinic that already paid or has a subscription', async () => {
    expect(await run(deps(), { ...ROW, firstPaidAt: new Date() })).toBeNull()
    expect(await run(deps(), { ...ROW, stripeSubscriptionId: 'sub_1' })).toBeNull()
  })

  it.each([
    ['ineligible', { status: 'ineligible' as never }],
    ['canceled', { status: 'canceled' as never }],
    ['already bound', { stripeSubscriptionId: 'sub_1' }],
  ])('gives nothing for an attribution that is %s', async (_n, patch) => {
    const d = deps({ attribution: vi.fn(async () => ({ ...ATTRIBUTION, ...patch })) })
    expect(await run(d)).toBeNull()
    expect(d.runChecks).not.toHaveBeenCalled()
  })

  it('gives nothing without a sellable monthly plan', async () => {
    expect(await run(deps(), ROW, [PLANS[1]])).toBeNull()
  })

  it('gives nothing when Stripe rejects the promotion code', async () => {
    expect(await run(deps({ check: vi.fn(async () => null) }))).toBeNull()
  })

  it.each<[string, Partial<PromotionCodeTerms>]>([
    ['applies_to', { productIds: ['prod_1'] }],
    ['another percent', { percentOff: 100 }],
    ['an amount off', { percentOff: null, amountOffCents: 2000 }],
    ['forever', { duration: 'forever', durationInMonths: null }],
    ['another month count', { durationInMonths: 12 }],
    ['no first-time restriction', { firstTimeTransaction: false }],
  ])('treats a promotion code with %s as misconfigured and reports it', async (_n, over) => {
    const d = deps({ check: vi.fn(async () => ({ ...TERMS, ...over })) })
    expect(await run(d)).toBeNull()
    expect(d.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'referral_promo_misconfigured' }))
  })

  it('gives nothing to a first-time-only code when the customer purchased before', async () => {
    const d = deps({ priorPurchase: vi.fn(async () => true) })
    expect(await run(d, { ...ROW, stripeCustomerId: 'cus_1' })).toBeNull()
    expect(d.priorPurchase).toHaveBeenCalledWith('cus_1', NOW)
  })

  it('does not ask about prior purchases without a customer', async () => {
    const d = deps()
    expect(await run(d)).not.toBeNull()
    expect(d.priorPurchase).not.toHaveBeenCalled()
  })
})

describe('publicReferralOffer', () => {
  it('drops the server-only ids', async () => {
    const offer = await run(deps())
    const pub = publicReferralOffer(offer)
    expect(pub).not.toHaveProperty('promotionCodeId')
    expect(pub).not.toHaveProperty('referralId')
    expect(pub?.referrerName).toBe('Clínica Bela')
    expect(publicReferralOffer(null)).toBeNull()
  })
})

describe('chooseCheckoutDiscount', () => {
  const f = { promotionCodeId: 'f' }
  const w = { promotionCodeId: 'w' }
  const r = { promotionCodeId: 'r' }
  it.each([
    [null, w, null, { kind: 'winback', promotionCodeId: 'w' }],
    [null, null, r, { kind: 'referral', promotionCodeId: 'r' }],
    [null, w, r, { kind: 'winback', promotionCodeId: 'w' }],
    [null, null, null, { kind: null, promotionCodeId: null }],
    // The feedback reward beats both, and only its code is applied.
    [f, w, r, { kind: 'feedback', promotionCodeId: 'f' }],
    [f, null, r, { kind: 'feedback', promotionCodeId: 'f' }],
    [f, w, null, { kind: 'feedback', promotionCodeId: 'f' }],
  ])('feedback %j + winback %j + referral %j', (feedback, winback, referral, expected) => {
    expect(chooseCheckoutDiscount({ feedback, winback, referral })).toEqual(expected)
  })
})

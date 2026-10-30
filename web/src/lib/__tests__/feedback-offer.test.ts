import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({ checkPromotionCode: vi.fn(), getPriceInfo: vi.fn(), customerHasPriorPurchase: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))

import { getValidatedFeedbackOffer, publicFeedbackOffer } from '@/lib/feedback-offer'
import type { PriceInfo, PromotionCodeTerms } from '@/lib/stripe'

const NOW = new Date('2026-10-30T15:00:00.000Z')
const ENV = { STRIPE_FEEDBACK_PROMOTION_CODE_ID: 'promo_feedback' }
const GRANTED = new Date('2026-10-29T15:00:00.000Z')
const TRIALING = {
  tenantId: 't1',
  status: 'trialing',
  source: 'trial',
  stripeSubscriptionId: null,
  stripeCustomerId: null,
  firstPaidAt: null,
  currentPeriodEnd: new Date('2026-11-05T15:00:00.000Z'),
  feedbackDiscountGrantedAt: GRANTED,
}
const EXPIRED = { ...TRIALING, status: 'expired', currentPeriodEnd: new Date('2026-10-20T15:00:00.000Z') }
const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 9900, stripePriceId: 'price_starter' },
  { slug: 'pro', name: 'Pro', priceCents: 19900, stripePriceId: 'price_pro' },
]
const PRODUCTS: Record<string, string> = { price_starter: 'prod_starter', price_pro: 'prod_pro' }

const TERMS: PromotionCodeTerms = {
  percentOff: 50,
  amountOffCents: null,
  duration: 'repeating',
  durationInMonths: 3,
  productIds: null,
  firstTimeTransaction: true,
  minimumAmountCents: null,
}

function deps(terms: PromotionCodeTerms | null, prior = false) {
  return {
    check: vi.fn(async () => terms),
    priceInfo: vi.fn(async (priceId: string): Promise<PriceInfo | null> => ({ productId: PRODUCTS[priceId], unitAmountCents: 9900 })),
    priorPurchase: vi.fn(async (): Promise<boolean> => prior),
    report: vi.fn(),
  }
}

describe('getValidatedFeedbackOffer', () => {
  it.each([
    ['a running trial', TRIALING],
    ['a trial that ended (read-only)', EXPIRED],
  ])('offers the coupon on every plan for %s that was flagged', async (_, row) => {
    const d = deps(TERMS)
    const offer = await getValidatedFeedbackOffer(row, PLANS, NOW, ENV, d)
    expect(d.check).toHaveBeenCalledWith('promo_feedback', NOW)
    expect(offer).toEqual({
      kind: 'feedback',
      promotionCodeId: 'promo_feedback',
      label: '50% de desconto nos 3 primeiros meses',
      percentOff: 50,
      amountOffCents: null,
      duration: 'repeating',
      durationInMonths: 3,
      planSlugs: ['starter', 'pro'],
    })
  })

  it('also counts a trial row whose status still says trialing past its end', async () => {
    const stale = { ...TRIALING, currentPeriodEnd: new Date('2026-10-20T15:00:00.000Z') }
    expect(await getValidatedFeedbackOffer(stale, PLANS, NOW, ENV, deps(TERMS))).not.toBeNull()
  })

  it('offers nothing to a clinic nobody flagged, without asking Stripe', async () => {
    const d = deps(TERMS)
    expect(await getValidatedFeedbackOffer({ ...TRIALING, feedbackDiscountGrantedAt: null }, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.check).not.toHaveBeenCalled()
  })

  it('offers nothing while the promotion code id is not configured', async () => {
    const d = deps(TERMS)
    expect(await getValidatedFeedbackOffer(TRIALING, PLANS, NOW, {}, d)).toBeNull()
    expect(await getValidatedFeedbackOffer(TRIALING, PLANS, NOW, { STRIPE_FEEDBACK_PROMOTION_CODE_ID: '  ' }, d)).toBeNull()
    expect(d.check).not.toHaveBeenCalled()
  })

  it.each([
    ['a live Stripe subscription', { source: 'stripe', status: 'active', stripeSubscriptionId: 'sub_1' }],
    ['a past_due Stripe subscription', { source: 'stripe', status: 'past_due', stripeSubscriptionId: 'sub_1' }],
    ['a clinic that paid before', { ...EXPIRED, firstPaidAt: new Date('2026-01-01T00:00:00.000Z') }],
    ['a gift', { source: 'gift', status: 'active' }],
    ['a cancelled trial row', { status: 'canceled' }],
  ])('offers nothing to %s even when flagged', async (_, over) => {
    const d = deps(TERMS)
    expect(await getValidatedFeedbackOffer({ ...TRIALING, ...over }, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.check).not.toHaveBeenCalled()
  })

  it('offers nothing when Stripe says the code is inactive or invalid', async () => {
    expect(await getValidatedFeedbackOffer(TRIALING, PLANS, NOW, ENV, deps(null))).toBeNull()
  })

  it('offers nothing, and reports, when a Stripe call throws', async () => {
    const d = deps(TERMS)
    d.check.mockRejectedValue(new Error('stripe down'))
    expect(await getValidatedFeedbackOffer(TRIALING, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'feedback_offer' }))
  })

  it('offers nothing when the first-time-only code would be refused for this customer', async () => {
    const d = deps(TERMS, true)
    expect(await getValidatedFeedbackOffer({ ...TRIALING, stripeCustomerId: 'cus_old' }, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.priorPurchase).toHaveBeenCalledWith('cus_old', NOW)
  })

  it('limits the offer to the plans a restricted coupon covers, and says which', async () => {
    const offer = await getValidatedFeedbackOffer(TRIALING, PLANS, NOW, ENV, deps({ ...TERMS, productIds: ['prod_pro'] }))
    expect(offer?.planSlugs).toEqual(['pro'])
    expect(offer?.label).toBe('50% de desconto nos 3 primeiros meses no plano Pro')
  })

  it('keeps the promotion code id server-side', () => {
    const pub = publicFeedbackOffer({
      kind: 'feedback',
      promotionCodeId: 'promo_feedback',
      label: 'x',
      percentOff: 50,
      amountOffCents: null,
      duration: 'repeating',
      durationInMonths: 3,
      planSlugs: ['pro'],
    })
    expect(pub).not.toHaveProperty('promotionCodeId')
    expect(publicFeedbackOffer(null)).toBeNull()
  })
})

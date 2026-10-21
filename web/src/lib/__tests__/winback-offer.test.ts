import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({ checkPromotionCode: vi.fn(), getPriceProductId: vi.fn() }))

import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import type { PromotionCodeTerms } from '@/lib/stripe'

const END = new Date('2026-10-19T15:00:00.000Z')
const NOW = new Date('2026-10-21T13:00:00.000Z')
const ENV = { STRIPE_WINBACK_PROMOTION_CODE_ID: 'promo_1' }
const ROW = { status: 'expired', source: 'trial', stripeSubscriptionId: null, firstPaidAt: null, currentPeriodEnd: END }
const PLANS = [
  { slug: 'starter', name: 'Starter', stripePriceId: 'price_starter' },
  { slug: 'pro', name: 'Pro', stripePriceId: 'price_pro' },
]
const PRODUCTS: Record<string, string> = { price_starter: 'prod_starter', price_pro: 'prod_pro' }

const TERMS: PromotionCodeTerms = {
  percentOff: 30,
  amountOffCents: null,
  duration: 'repeating',
  durationInMonths: 3,
  productIds: null,
}

function deps(terms: PromotionCodeTerms | null) {
  return {
    check: vi.fn(async () => terms),
    priceProduct: vi.fn(async (priceId: string): Promise<string | null> => PRODUCTS[priceId] ?? null),
  }
}

describe('getValidatedWinbackOffer', () => {
  it('builds the label and terms from the coupon, for every plan when it is not restricted', async () => {
    const d = deps(TERMS)
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d)
    expect(d.check).toHaveBeenCalledWith('promo_1', NOW)
    expect(d.priceProduct).not.toHaveBeenCalled()
    expect(offer).toMatchObject({
      promotionCodeId: 'promo_1',
      label: '30% de desconto nos 3 primeiros meses',
      percentOff: 30,
      durationInMonths: 3,
      planSlugs: ['starter', 'pro'],
    })
  })

  it('limits the offer to the plans whose product the coupon applies to, and says which', async () => {
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, deps({ ...TERMS, productIds: ['prod_pro'] }))
    expect(offer?.planSlugs).toEqual(['pro'])
    expect(offer?.label).toBe('30% de desconto nos 3 primeiros meses no plano Pro')
  })

  it('offers nothing when the coupon covers none of the plans on sale', async () => {
    expect(await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, deps({ ...TERMS, productIds: ['prod_other'] }))).toBeNull()
  })

  it('treats a plan whose product lookup failed as not covered', async () => {
    const d = deps({ ...TERMS, productIds: ['prod_starter', 'prod_pro'] })
    d.priceProduct.mockImplementation(async (priceId: string) => (priceId === 'price_pro' ? null : PRODUCTS[priceId]))
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d)
    expect(offer?.planSlugs).toEqual(['starter'])
  })

  it('hides the offer when Stripe says the code is unusable', async () => {
    expect(await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, deps(null))).toBeNull()
  })

  it('does not ask Stripe for a clinic that is not eligible', async () => {
    const d = deps(TERMS)
    expect(await getValidatedWinbackOffer({ ...ROW, firstPaidAt: END }, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.check).not.toHaveBeenCalled()
  })
})

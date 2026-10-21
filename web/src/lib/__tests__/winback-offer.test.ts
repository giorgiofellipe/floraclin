import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({ checkPromotionCode: vi.fn(), getPriceInfo: vi.fn(), customerHasPriorPurchase: vi.fn() }))

vi.mock('@/db/queries/trial-recap', () => ({ getTrialUsage: vi.fn() }))

import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import type { PriceInfo, PromotionCodeTerms } from '@/lib/stripe'

const END = new Date('2026-10-19T15:00:00.000Z')
const NOW = new Date('2026-10-21T13:00:00.000Z')
const ENV = { STRIPE_WINBACK_PROMOTION_CODE_ID: 'promo_1' }
const ROW = { tenantId: 't1', status: 'expired', source: 'trial', stripeSubscriptionId: null, firstPaidAt: null, currentPeriodEnd: END }
const PLANS = [
  { slug: 'starter', name: 'Starter', priceCents: 9900, stripePriceId: 'price_starter' },
  { slug: 'pro', name: 'Pro', priceCents: 19900, stripePriceId: 'price_pro' },
]
const PRODUCTS: Record<string, string> = { price_starter: 'prod_starter', price_pro: 'prod_pro' }
const AMOUNTS: Record<string, number> = { price_starter: 9900, price_pro: 19900 }

const TERMS: PromotionCodeTerms = {
  percentOff: 30,
  amountOffCents: null,
  duration: 'repeating',
  durationInMonths: 3,
  productIds: null,
  firstTimeTransaction: true,
  minimumAmountCents: null,
}

function deps(terms: PromotionCodeTerms | null, prior = false, used = true) {
  return {
    usedTrial: vi.fn(async (): Promise<boolean> => used),
    check: vi.fn(async () => terms),
    priceInfo: vi.fn(async (priceId: string): Promise<PriceInfo | null> =>
      PRODUCTS[priceId] ? { productId: PRODUCTS[priceId], unitAmountCents: AMOUNTS[priceId] } : null,
    ),
    priorPurchase: vi.fn(async (): Promise<boolean> => prior),
  }
}

describe('getValidatedWinbackOffer', () => {
  it('builds the label and terms from the coupon, for every plan when it is not restricted', async () => {
    const d = deps(TERMS)
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d)
    expect(d.check).toHaveBeenCalledWith('promo_1', NOW)
    expect(d.priceInfo).not.toHaveBeenCalled()
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
    d.priceInfo.mockImplementation(async (priceId: string) =>
      priceId === 'price_pro' ? null : { productId: PRODUCTS[priceId], unitAmountCents: AMOUNTS[priceId] },
    )
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

  it('asks Stripe about the customer only when the clinic has one, and only for a first-time code', async () => {
    const fresh = deps(TERMS)
    expect(await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, fresh)).not.toBeNull()
    expect(fresh.priorPurchase).not.toHaveBeenCalled()

    const anyone = deps({ ...TERMS, firstTimeTransaction: false }, true)
    expect(await getValidatedWinbackOffer({ ...ROW, stripeCustomerId: 'cus_1' }, PLANS, NOW, ENV, anyone)).not.toBeNull()
    expect(anyone.priorPurchase).not.toHaveBeenCalled()
  })

  it("hides the offer when the clinic's Stripe customer has paid or subscribed before", async () => {
    const d = deps(TERMS, true)
    expect(await getValidatedWinbackOffer({ ...ROW, stripeCustomerId: 'cus_1' }, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.priorPurchase).toHaveBeenCalledWith('cus_1', NOW)
  })

  it('keeps the offer when a customer on the row never paid (defence in depth)', async () => {
    const d = deps(TERMS, false)
    const offer = await getValidatedWinbackOffer({ ...ROW, stripeCustomerId: 'cus_1' }, PLANS, NOW, ENV, d)
    expect(offer?.planSlugs).toEqual(['starter', 'pro'])
  })

  it('checks the minimum against the Stripe price, not our copy of it', async () => {
    const d = deps({ ...TERMS, minimumAmountCents: 15000 })
    // Our table says R$ 99 but the Stripe price is R$ 199: Stripe accepts it.
    d.priceInfo.mockImplementation(async (priceId: string) => ({ productId: PRODUCTS[priceId], unitAmountCents: 19900 }))
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d)
    expect(offer?.planSlugs).toEqual(['starter', 'pro'])
  })

  it('leaves out a plan whose Stripe price has no fixed BRL amount when there is a minimum', async () => {
    const d = deps({ ...TERMS, minimumAmountCents: 5000 })
    d.priceInfo.mockImplementation(async (priceId: string) => ({
      productId: PRODUCTS[priceId],
      unitAmountCents: priceId === 'price_pro' ? null : AMOUNTS[priceId],
    }))
    expect((await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d))?.planSlugs).toEqual(['starter'])
  })

  it('leaves out plans priced under the code minimum amount', async () => {
    const offer = await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, deps({ ...TERMS, minimumAmountCents: 15000 }))
    expect(offer?.planSlugs).toEqual(['pro'])
    expect(offer?.label).toBe('30% de desconto nos 3 primeiros meses no plano Pro')
    expect(await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, deps({ ...TERMS, minimumAmountCents: 20000 }))).toBeNull()
  })

  // The paywall (platform layout), checkout and the emails all read the offer
  // from here, so this is the gate for every surface.
  it('offers nothing to a clinic that never used the trial, before asking Stripe', async () => {
    const d = deps(TERMS, false, false)
    expect(await getValidatedWinbackOffer(ROW, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.usedTrial).toHaveBeenCalledWith('t1')
    expect(d.check).not.toHaveBeenCalled()
  })

  it('offers nothing when the row does not say which clinic it is', async () => {
    const d = deps(TERMS)
    const { tenantId: _omit, ...anonymous } = ROW
    expect(await getValidatedWinbackOffer(anonymous, PLANS, NOW, ENV, d)).toBeNull()
    expect(d.usedTrial).not.toHaveBeenCalled()
  })
})

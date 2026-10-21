import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({ checkPromotionCode: vi.fn() }))

import { getValidatedWinbackOffer } from '@/lib/winback-offer'

const END = new Date('2026-10-19T15:00:00.000Z')
const NOW = new Date('2026-10-21T13:00:00.000Z')
const ENV = { STRIPE_WINBACK_PROMOTION_CODE_ID: 'promo_1', WINBACK_OFFER_LABEL: '30% de desconto nos 3 primeiros meses' }
const ROW = { status: 'expired', source: 'trial', stripeSubscriptionId: null, firstPaidAt: null, currentPeriodEnd: END }

describe('getValidatedWinbackOffer', () => {
  it('carries the coupon terms when Stripe accepts the code', async () => {
    const check = vi.fn(async () => ({ percentOff: 30, durationInMonths: 3 }))
    const offer = await getValidatedWinbackOffer(ROW, NOW, ENV, check)
    expect(check).toHaveBeenCalledWith('promo_1', NOW)
    expect(offer).toMatchObject({ promotionCodeId: 'promo_1', percentOff: 30, durationInMonths: 3 })
  })

  it('hides the offer when Stripe says the code is unusable', async () => {
    expect(await getValidatedWinbackOffer(ROW, NOW, ENV, vi.fn(async () => null))).toBeNull()
  })

  it('does not ask Stripe for a clinic that is not eligible', async () => {
    const check = vi.fn()
    expect(await getValidatedWinbackOffer({ ...ROW, firstPaidAt: END }, NOW, ENV, check)).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })
})

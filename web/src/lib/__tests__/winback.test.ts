import { describe, expect, it } from 'vitest'
import { getWinbackOffer, publicWinbackOffer } from '@/lib/winback'

const END = new Date('2026-10-20T15:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ENV = { STRIPE_WINBACK_PROMOTION_CODE_ID: 'promo_123', WINBACK_OFFER_LABEL: '30% de desconto nos 3 primeiros meses' }
const expiredTrial = { status: 'expired', source: 'trial', stripeSubscriptionId: null, firstPaidAt: null, currentPeriodEnd: END }

describe('getWinbackOffer', () => {
  it('is off until the promotion code is configured', () => {
    expect(getWinbackOffer(expiredTrial, new Date(END.getTime() + DAY), {})).toBeNull()
  })

  it('offers it to a trial that ran out, inside the window', () => {
    const offer = getWinbackOffer(expiredTrial, new Date(END.getTime() + DAY), ENV)
    expect(offer).toEqual({
      promotionCodeId: 'promo_123',
      label: '30% de desconto nos 3 primeiros meses',
      endsAt: new Date(END.getTime() + 14 * DAY).toISOString(),
    })
  })

  it('also covers a trial the cron has not rewritten yet', () => {
    const offer = getWinbackOffer({ ...expiredTrial, status: 'trialing' }, new Date(END.getTime() + 1000), ENV)
    expect(offer?.promotionCodeId).toBe('promo_123')
  })

  it('closes after WINBACK_OFFER_DAYS', () => {
    const env = { ...ENV, WINBACK_OFFER_DAYS: '7' }
    expect(getWinbackOffer(expiredTrial, new Date(END.getTime() + 7 * DAY - 1), env)).not.toBeNull()
    expect(getWinbackOffer(expiredTrial, new Date(END.getTime() + 7 * DAY + 1), env)).toBeNull()
  })

  it('never goes to a running trial, a past payer, or a lapsed gift', () => {
    const after = new Date(END.getTime() + DAY)
    expect(getWinbackOffer({ ...expiredTrial, status: 'trialing' }, new Date(END.getTime() - DAY), ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, firstPaidAt: new Date('2026-09-01') }, after, ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, source: 'gift' }, after, ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, status: 'canceled', source: 'stripe', stripeSubscriptionId: 'sub_1' }, after, ENV)).toBeNull()
  })

  it('keeps the promotion code id out of what the client gets', () => {
    const offer = getWinbackOffer(expiredTrial, new Date(END.getTime() + DAY), ENV)
    expect(publicWinbackOffer(offer)).toEqual({ label: ENV.WINBACK_OFFER_LABEL, endsAt: offer!.endsAt })
  })
})

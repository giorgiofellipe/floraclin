import { describe, expect, it } from 'vitest'
import { getWinbackOffer, publicWinbackOffer, winbackOfferLabel, winbackPriceCents } from '@/lib/winback'

const END = new Date('2026-10-20T15:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ENV = { STRIPE_WINBACK_PROMOTION_CODE_ID: 'promo_123' }
const expiredTrial = { status: 'expired', source: 'trial', stripeSubscriptionId: null, firstPaidAt: null, currentPeriodEnd: END }

describe('getWinbackOffer', () => {
  it('is off until the promotion code is configured', () => {
    expect(getWinbackOffer(expiredTrial, new Date(END.getTime() + DAY), {})).toBeNull()
  })

  it('offers it to a trial that ran out, inside the window', () => {
    const offer = getWinbackOffer(expiredTrial, new Date(END.getTime() + DAY), ENV)
    // Trial ended 20/10 12:00 BRT; 14 days later is 03/11, open until 23:59:59 BRT.
    expect(offer).toEqual({
      promotionCodeId: 'promo_123',
      endsAt: '2026-11-04T02:59:59.999Z',
    })
  })

  it('also covers a trial the cron has not rewritten yet', () => {
    const offer = getWinbackOffer({ ...expiredTrial, status: 'trialing' }, new Date(END.getTime() + 1000), ENV)
    expect(offer?.promotionCodeId).toBe('promo_123')
  })

  it('stays open through the whole last day in São Paulo, then closes', () => {
    const env = { ...ENV, WINBACK_OFFER_DAYS: '7' }
    // 27/10 23:59 BRT is still inside; 28/10 00:00 BRT is not.
    expect(getWinbackOffer(expiredTrial, new Date('2026-10-28T02:59:00.000Z'), env)).not.toBeNull()
    expect(getWinbackOffer(expiredTrial, new Date('2026-10-28T03:00:00.000Z'), env)).toBeNull()
  })

  it('never goes to a running trial, a past payer, or a lapsed gift', () => {
    const after = new Date(END.getTime() + DAY)
    expect(getWinbackOffer({ ...expiredTrial, status: 'trialing' }, new Date(END.getTime() - DAY), ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, firstPaidAt: new Date('2026-09-01') }, after, ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, source: 'gift' }, after, ENV)).toBeNull()
    expect(getWinbackOffer({ ...expiredTrial, status: 'canceled', source: 'stripe', stripeSubscriptionId: 'sub_1' }, after, ENV)).toBeNull()
  })

  it('keeps the promotion code id out of what the client gets', () => {
    const validated = {
      promotionCodeId: 'promo_123',
      endsAt: '2026-11-04T02:59:59.999Z',
      label: '30% de desconto nos 3 primeiros meses',
      percentOff: 30,
      amountOffCents: null,
      duration: 'repeating' as const,
      durationInMonths: 3,
      planSlugs: ['starter', 'pro'],
    }
    const { promotionCodeId: _omit, ...expected } = validated
    expect(publicWinbackOffer(validated)).toEqual(expected)
    expect(JSON.stringify(publicWinbackOffer(validated))).not.toContain('promo_')
  })
})

describe('winbackOfferLabel', () => {
  it.each<[string, Parameters<typeof winbackOfferLabel>[0], string]>([
    ['repeating', { percentOff: 30, amountOffCents: null, duration: 'repeating', durationInMonths: 3 }, '30% de desconto nos 3 primeiros meses'],
    ['one month', { percentOff: 50, amountOffCents: null, duration: 'repeating', durationInMonths: 1 }, '50% de desconto no primeiro mês'],
    ['once', { percentOff: 20, amountOffCents: null, duration: 'once', durationInMonths: null }, '20% de desconto na primeira mensalidade'],
    ['forever', { percentOff: 10, amountOffCents: null, duration: 'forever', durationInMonths: null }, '10% de desconto em todas as mensalidades'],
    ['amount off', { percentOff: null, amountOffCents: 5000, duration: 'once', durationInMonths: null }, 'R$\u00a050,00 de desconto na primeira mensalidade'],
  ])('%s', (_name, terms, expected) => {
    expect(winbackOfferLabel(terms)).toBe(expected)
  })

  it('names the covered plans only when the coupon leaves some out', () => {
    const terms = { percentOff: 30, amountOffCents: null, duration: 'repeating' as const, durationInMonths: 3 }
    expect(winbackOfferLabel(terms, ['Pro'], false)).toBe('30% de desconto nos 3 primeiros meses no plano Pro')
    expect(winbackOfferLabel(terms, ['Starter', 'Pro'], true)).toBe('30% de desconto nos 3 primeiros meses')
  })
})

describe('winbackPriceCents', () => {
  const offer = { percentOff: 30, amountOffCents: null, planSlugs: ['pro'] }
  it('discounts a covered plan and leaves the others at full price', () => {
    expect(winbackPriceCents({ slug: 'pro', priceCents: 19900 }, offer)).toBe(13930)
    expect(winbackPriceCents({ slug: 'starter', priceCents: 9900 }, offer)).toBeNull()
  })
  it('takes a BRL amount off, never below zero', () => {
    const amount = { percentOff: null, amountOffCents: 5000, planSlugs: ['starter'] }
    expect(winbackPriceCents({ slug: 'starter', priceCents: 9900 }, amount)).toBe(4900)
    expect(winbackPriceCents({ slug: 'starter', priceCents: 3000 }, amount)).toBe(0)
  })
})

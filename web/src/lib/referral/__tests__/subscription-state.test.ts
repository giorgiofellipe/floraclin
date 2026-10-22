import { describe, expect, it } from 'vitest'
import { referrerSubscriptionState, stripeSubscriptionIsMonthly } from '../subscription-state'

type Sub = Parameters<typeof stripeSubscriptionIsMonthly>[0]

function sub(status: string, recurring: { interval: string; interval_count: number } | null = { interval: 'month', interval_count: 1 }): Sub {
  return { status, items: { data: [{ price: { recurring } }] } } as Sub
}

describe('referrerSubscriptionState', () => {
  it.each(['active', 'trialing', 'past_due'])('%s monthly stripe is updatable and eligible', (status) => {
    expect(referrerSubscriptionState(sub(status), 'stripe')).toEqual({ updatable: true, eligible: true })
  })

  it('treats cancel_at_period_end as still open', () => {
    const s = { ...sub('active'), cancel_at_period_end: true } as Sub
    expect(referrerSubscriptionState(s, 'stripe')).toEqual({ updatable: true, eligible: true })
  })

  it('yearly is updatable but not eligible', () => {
    expect(referrerSubscriptionState(sub('active', { interval: 'year', interval_count: 1 }), 'stripe')).toEqual({
      updatable: true,
      eligible: false,
    })
  })

  it('a gift row over a live sub is updatable but not eligible', () => {
    expect(referrerSubscriptionState(sub('active'), 'gift')).toEqual({ updatable: true, eligible: false })
  })

  it('unpaid is updatable but not eligible', () => {
    expect(referrerSubscriptionState(sub('unpaid'), 'stripe')).toEqual({ updatable: true, eligible: false })
  })

  it.each(['canceled', 'incomplete_expired', 'incomplete'])('%s is neither', (status) => {
    expect(referrerSubscriptionState(sub(status), 'stripe')).toEqual({ updatable: false, eligible: false })
  })

  it('missing and null are neither', () => {
    expect(referrerSubscriptionState('missing', 'stripe')).toEqual({ updatable: false, eligible: false })
    expect(referrerSubscriptionState(null, 'stripe')).toEqual({ updatable: false, eligible: false })
  })
})

describe('stripeSubscriptionIsMonthly', () => {
  it('is true only for month × 1', () => {
    expect(stripeSubscriptionIsMonthly(sub('active'))).toBe(true)
    expect(stripeSubscriptionIsMonthly(sub('active', { interval: 'month', interval_count: 3 }))).toBe(false)
    expect(stripeSubscriptionIsMonthly(sub('active', { interval: 'year', interval_count: 1 }))).toBe(false)
    expect(stripeSubscriptionIsMonthly(sub('active', null))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { effectiveSubscriptionStatus, isSubscriptionRowActive } from '@/lib/subscription-access'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const PAST = new Date('2026-10-21T11:59:59.000Z')
const FUTURE = new Date('2026-10-21T12:00:01.000Z')

describe('isSubscriptionRowActive', () => {
  it('fails closed on a missing row', () => {
    expect(isSubscriptionRowActive(null, NOW)).toBe(false)
  })

  it.each([
    ['trialing', 'trial', null, FUTURE, true],
    ['trialing', 'trial', null, PAST, false],
    ['active', 'gift', null, FUTURE, true],
    ['active', 'gift', null, PAST, false],
    ['active', 'admin', null, PAST, false],
    ['active', 'stripe', 'sub_1', PAST, true],
    ['canceled', 'stripe', 'sub_1', FUTURE, true],
    ['canceled', 'stripe', 'sub_1', PAST, false],
    ['past_due', 'stripe', 'sub_1', FUTURE, true],
    ['past_due', 'stripe', 'sub_1', PAST, false],
    ['expired', 'trial', null, FUTURE, false],
  ] as const)('%s / %s / %s ending %s -> %s', (status, source, stripeSubscriptionId, end, expected) => {
    expect(isSubscriptionRowActive({ status, source, stripeSubscriptionId, currentPeriodEnd: end }, NOW)).toBe(expected)
  })

  it('accepts ISO strings (the shape the client receives)', () => {
    expect(isSubscriptionRowActive({ status: 'trialing', source: 'trial', currentPeriodEnd: PAST.toISOString() }, NOW)).toBe(false)
  })
})

describe('effectiveSubscriptionStatus', () => {
  it('shows a lapsed trial or gift as expired before the cron rewrites it', () => {
    expect(effectiveSubscriptionStatus({ status: 'trialing', source: 'trial', currentPeriodEnd: PAST }, NOW)).toBe('expired')
    expect(effectiveSubscriptionStatus({ status: 'active', source: 'gift', currentPeriodEnd: PAST }, NOW)).toBe('expired')
  })

  it('leaves every other status as stored', () => {
    expect(effectiveSubscriptionStatus({ status: 'trialing', source: 'trial', currentPeriodEnd: FUTURE }, NOW)).toBe('trialing')
    expect(effectiveSubscriptionStatus({ status: 'active', source: 'stripe', stripeSubscriptionId: 's', currentPeriodEnd: PAST }, NOW)).toBe('active')
    expect(effectiveSubscriptionStatus({ status: 'canceled', source: 'stripe', currentPeriodEnd: PAST }, NOW)).toBe('canceled')
    expect(effectiveSubscriptionStatus(null, NOW)).toBeNull()
  })
})

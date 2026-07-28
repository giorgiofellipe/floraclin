/**
 * Tests for the subscription gate helpers in lib/plans.
 *
 * Pins the enforcement semantics: fail-closed on a missing row,
 * trialing/active always pass, canceled/past_due honor the paid period,
 * expired always blocks, and platform admins bypass the route gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const limitMock = vi.fn()

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: limitMock,
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  tenantUsers: {},
  patients: {},
  whatsappCredits: {},
  tenantSubscriptions: { tenantId: 'tenant_id', status: 'status', currentPeriodEnd: 'current_period_end' },
  plans: {},
}))

import {
  isSubscriptionActive,
  subscriptionGate,
  requireActiveSubscription,
  SubscriptionExpiredError,
  SUBSCRIPTION_EXPIRED_RESPONSE,
} from '../plans'

const TENANT = 'tenant-1'
const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
const past = new Date(Date.now() - 24 * 60 * 60 * 1000)

beforeEach(() => {
  limitMock.mockReset()
})

describe('isSubscriptionActive', () => {
  it('fails closed when no subscription row exists', async () => {
    limitMock.mockResolvedValue([])
    expect(await isSubscriptionActive(TENANT)).toBe(false)
  })

  it.each(['trialing', 'active'])('returns true for %s regardless of period end', async (status) => {
    limitMock.mockResolvedValue([{ status, currentPeriodEnd: past }])
    expect(await isSubscriptionActive(TENANT)).toBe(true)
  })

  it.each(['canceled', 'past_due'])('%s stays active until the period ends', async (status) => {
    limitMock.mockResolvedValue([{ status, currentPeriodEnd: future }])
    expect(await isSubscriptionActive(TENANT)).toBe(true)
  })

  it.each(['canceled', 'past_due'])('%s blocks after the period ends', async (status) => {
    limitMock.mockResolvedValue([{ status, currentPeriodEnd: past }])
    expect(await isSubscriptionActive(TENANT)).toBe(false)
  })

  it('blocks expired regardless of period end', async () => {
    limitMock.mockResolvedValue([{ status: 'expired', currentPeriodEnd: future }])
    expect(await isSubscriptionActive(TENANT)).toBe(false)
  })
})

describe('subscriptionGate', () => {
  it('never blocks platform admins (no db query)', async () => {
    const gate = await subscriptionGate({ tenantId: TENANT, isPlatformAdmin: true })
    expect(gate).toBeNull()
    expect(limitMock).not.toHaveBeenCalled()
  })

  it('returns null for an active subscription', async () => {
    limitMock.mockResolvedValue([{ status: 'active', currentPeriodEnd: future }])
    expect(await subscriptionGate({ tenantId: TENANT })).toBeNull()
  })

  it('returns a 402 with the subscription_expired code when blocked', async () => {
    limitMock.mockResolvedValue([{ status: 'expired', currentPeriodEnd: past }])
    const gate = await subscriptionGate({ tenantId: TENANT })
    expect(gate).not.toBeNull()
    expect(gate!.status).toBe(402)
    expect(await gate!.json()).toEqual(SUBSCRIPTION_EXPIRED_RESPONSE.body)
  })
})

describe('requireActiveSubscription', () => {
  it('resolves for an active tenant', async () => {
    limitMock.mockResolvedValue([{ status: 'trialing', currentPeriodEnd: future }])
    await expect(requireActiveSubscription(TENANT)).resolves.toBeUndefined()
  })

  it('throws SubscriptionExpiredError with the standard message when blocked', async () => {
    limitMock.mockResolvedValue([])
    await expect(requireActiveSubscription(TENANT)).rejects.toThrow(SubscriptionExpiredError)
    limitMock.mockResolvedValue([])
    await expect(requireActiveSubscription(TENANT)).rejects.toThrow(
      SUBSCRIPTION_EXPIRED_RESPONSE.body.error,
    )
  })
})

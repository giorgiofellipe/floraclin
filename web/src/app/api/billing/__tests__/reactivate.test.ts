import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cancelling sets `cancel_at_period_end`, so between the click and the period
 * closing the subscription is still live at Stripe and the cancellation is
 * just a flag. Clearing it is the entire operation.
 *
 * Before this route the banner offered "Reativar" and linked to a page with
 * nothing to click: the cancel button hides itself once the status is
 * canceled, and the plan they were on renders as current, so the only way
 * back was to buy a DIFFERENT plan, which opened a second subscription
 * alongside the one still running.
 */

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ resumeStripeSubscription: vi.fn() }))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { resumeStripeSubscription } from '@/lib/stripe'
import { getSubscription, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { POST } from '../reactivate/route'

const NOW = new Date('2026-08-31T12:00:00.000Z')
const PERIOD_OPEN = new Date('2026-09-20T00:00:00.000Z')
const PERIOD_CLOSED = new Date('2026-08-01T00:00:00.000Z')

/** Cancelled, but the paid period has not run out yet. */
const CANCELED_OPEN = {
  planId: 'plan-starter',
  status: 'canceled',
  stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: PERIOD_OPEN,
  canceledAt: new Date('2026-08-30T00:00:00.000Z'),
}

function request() {
  return new Request('http://localhost/api/billing/reactivate', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getSubscription).mockResolvedValue(CANCELED_OPEN as never)
  vi.mocked(resumeStripeSubscription).mockResolvedValue({ id: 'sub_1' } as never)
  vi.mocked(updateSubscriptionStatus).mockResolvedValue(undefined as never)
})

describe('POST /api/billing/reactivate', () => {
  it('clears the pending cancellation at Stripe', async () => {
    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(resumeStripeSubscription).toHaveBeenCalledWith('sub_1')
  })

  it('puts the local row back to active and forgets the cancellation', async () => {
    await POST(request())

    // Explicitly null, not omitted: a stale canceledAt would keep telling the
    // rest of the app this subscription is on its way out.
    expect(updateSubscriptionStatus).toHaveBeenCalledWith('tenant-1', 'active', {
      canceledAt: null,
    })
  })

  it('refuses once the period has closed', async () => {
    // Nothing to resume. Stripe has ended the subscription, so the way back
    // is a new checkout, not this route.
    vi.mocked(getSubscription).mockResolvedValue({
      ...CANCELED_OPEN,
      currentPeriodEnd: PERIOD_CLOSED,
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(400)
    expect(resumeStripeSubscription).not.toHaveBeenCalled()
    expect(updateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('refuses a subscription that was never cancelled', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      ...CANCELED_OPEN,
      status: 'active',
      canceledAt: null,
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(400)
    expect(resumeStripeSubscription).not.toHaveBeenCalled()
  })

  it('refuses when there is no Stripe subscription to resume', async () => {
    // A gifted or admin-granted plan has no Stripe side.
    vi.mocked(getSubscription).mockResolvedValue({
      ...CANCELED_OPEN,
      stripeSubscriptionId: null,
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(400)
    expect(resumeStripeSubscription).not.toHaveBeenCalled()
  })

  it('404s when the tenant has no subscription row', async () => {
    vi.mocked(getSubscription).mockResolvedValue(null as never)

    const res = await POST(request())

    expect(res.status).toBe(404)
  })

  it('refuses a caller who is not the owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-2',
      role: 'receptionist',
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(resumeStripeSubscription).not.toHaveBeenCalled()
  })

  it('does not touch the local row when Stripe rejects the resume', async () => {
    // Writing active here would tell the tenant they are subscribed while
    // Stripe still has them cancelling at period end.
    vi.mocked(resumeStripeSubscription).mockRejectedValue(new Error('stripe down'))

    const res = await POST(request())

    expect(res.status).toBe(500)
    expect(updateSubscriptionStatus).not.toHaveBeenCalled()
  })
})

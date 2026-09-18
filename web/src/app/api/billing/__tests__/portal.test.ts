import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The app cannot update a card. `past_due` told the customer to update their
 * payment method and gave them nowhere to do it, so a clinic whose card
 * expired had no way back without contacting support. Stripe hosts the form,
 * and the same page carries their invoices.
 */

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ createBillingPortalSession: vi.fn() }))
vi.mock('@/db/queries/subscriptions', () => ({ getSubscription: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.example' }))

import { getAuthContext } from '@/lib/auth'
import { createBillingPortalSession } from '@/lib/stripe'
import { getSubscription } from '@/db/queries/subscriptions'
import { POST } from '../portal/route'

function request() {
  return new Request('http://localhost/api/billing/portal', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getSubscription).mockResolvedValue({
    status: 'past_due',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
  } as never)
  vi.mocked(createBillingPortalSession).mockResolvedValue({
    url: 'https://billing.stripe.com/session/xyz',
  } as never)
})

describe('POST /api/billing/portal', () => {
  it('returns a portal link for the caller tenant customer', async () => {
    const res = await POST(request())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ url: 'https://billing.stripe.com/session/xyz' })
    expect(createBillingPortalSession).toHaveBeenCalledWith(
      'cus_1',
      'https://app.example/configuracoes?tab=assinatura',
    )
  })

  it('works for a lapsed subscription, which is when it is needed most', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'expired',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(createBillingPortalSession).toHaveBeenCalledWith('cus_1', expect.any(String))
  })

  it('refuses when the tenant never paid, so has no Stripe customer', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'trialing',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(400)
    expect(createBillingPortalSession).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not the owner', async () => {
    // The portal exposes the card and every invoice.
    vi.mocked(getAuthContext).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-2',
      role: 'financial',
    } as never)

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(createBillingPortalSession).not.toHaveBeenCalled()
  })
})

describe('the usage endpoint tells the UI a portal is reachable', () => {
  it('reports hasStripeCustomer, which is the only thing drawing the link', async () => {
    // Nothing else exposes the customer id, so a route that stopped
    // reporting this would silently remove the only way to fix a failed card.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../usage/route.ts'),
      'utf8',
    )

    expect(src).toMatch(/hasStripeCustomer:\s*Boolean\(subscription\.stripeCustomerId\)/)
  })
})

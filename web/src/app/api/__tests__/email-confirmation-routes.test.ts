// @vitest-environment node
/**
 * Routes that act on an unproven address's word refuse an owner who has not
 * confirmed it: an invite is an e-mail to any address typed in, and checkout
 * makes the address a Stripe customer's. Without the gate both would run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ctx, inviteUserMock, createCheckoutSessionMock, attributeReferralMock } = vi.hoisted(() => ({
  ctx: {
    current: {
      userId: 'u1',
      tenantId: 't1',
      role: 'owner',
      email: 'ana@clinica.test',
      fullName: 'Ana',
      isPlatformAdmin: false,
      emailVerified: false as boolean | undefined,
    },
  },
  inviteUserMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
  attributeReferralMock: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn(async () => ({ ctx: ctx.current, blocked: null })) }))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn(async () => ctx.current) }))
vi.mock('@/db/queries/users', () => ({ inviteUser: inviteUserMock }))
vi.mock('@/lib/plans', () => ({ checkPlanLimit: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  createCheckoutSession: createCheckoutSessionMock,
  updateSubscriptionPrice: vi.fn(),
  prepareReferralAttach: vi.fn(),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: vi.fn(async () => null),
  getPlanBySlug: vi.fn(async () => null),
  updateSubscriptionPlan: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}))
vi.mock('@/lib/referral/attribution', () => ({ attributeReferral: attributeReferralMock }))
vi.mock('@/lib/referral/config', () => ({ isReferralEnrollmentEnabled: vi.fn(() => true) }))
vi.mock('@/db/client', () => ({ db: {} }))

import { POST as invite } from '@/app/api/tenant/users/invite/route'
import { POST as checkout } from '@/app/api/billing/checkout/route'
import { POST as attachReferral } from '@/app/api/referral/attach/route'

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  ctx.current = { ...ctx.current, emailVerified: false, isPlatformAdmin: false }
})

describe('unconfirmed owner', () => {
  it('cannot invite a team member, and no invite e-mail is sent', async () => {
    const res = await invite(new Request('http://localhost/api/tenant/users/invite', json({ email: 'x@y.test', fullName: 'X', role: 'receptionist' })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('email_unconfirmed')
    expect(inviteUserMock).not.toHaveBeenCalled()
  })

  it('cannot start a checkout', async () => {
    const res = await checkout(new Request('http://localhost/api/billing/checkout', json({ planSlug: 'pro' })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('email_unconfirmed')
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('cannot attach a referral code', async () => {
    const res = await attachReferral(new Request('http://localhost/api/referral/attach', json({ code: 'ABC123' })))
    expect(res.status).toBe(403)
    expect(attributeReferralMock).not.toHaveBeenCalled()
  })
})

describe('confirmed owner', () => {
  it('reaches the invite', async () => {
    ctx.current = { ...ctx.current, emailVerified: true }
    inviteUserMock.mockResolvedValue({ success: true })
    const res = await invite(new Request('http://localhost/api/tenant/users/invite', json({ email: 'x@y.test', fullName: 'Xavier Silva', role: 'receptionist' })))
    expect(res.status).not.toBe(403)
    expect(inviteUserMock).toHaveBeenCalled()
  })
})

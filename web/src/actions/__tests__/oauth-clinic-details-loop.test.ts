import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Google path used to dead-end in a loop.
 *
 * The JWT is minted at Google sign-in, before any clinic exists, so it carries
 * tenantId: null. Middleware sends every authenticated user without a tenant
 * to /signup/clinic-details. The action created the clinic and then redirected
 * to /dashboard, but the token in the request was still the old one, so
 * middleware bounced it right back to the form. Filling it in again hit the
 * existing-membership branch, which redirected to /dashboard, which bounced
 * again. The clinic was created on the first submit and the user could never
 * reach it.
 *
 * The fix is that neither branch redirects. Both report success, and the
 * client refreshes the session before navigating, so the token carries the new
 * tenantId by the time middleware sees it.
 */

const redirectMock = vi.fn((path: string) => {
  // next/navigation's redirect throws to unwind. Mirror that, or the code
  // after a redirect keeps running and the test proves nothing.
  const err = new Error(`NEXT_REDIRECT:${path}`)
  throw err
})

const authMock = vi.fn()
const selectMock = vi.fn()
const updateMock = vi.fn()
const executeMock = vi.fn()
const createSelfSignupTenantMock = vi.fn()
const createSubscriptionMock = vi.fn()

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirectMock(p) }))
vi.mock('@/lib/auth-config', () => ({ auth: () => authMock() }))
vi.mock('@/db/client', () => ({
  db: {
    select: () => selectMock(),
    update: (...a: unknown[]) => updateMock(...a),
    execute: (...a: unknown[]) => executeMock(...a),
  },
}))
vi.mock('@/db/queries/admin-tenants', () => ({
  createSelfSignupTenant: (...a: unknown[]) => createSelfSignupTenantMock(...a),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  createSubscription: (...a: unknown[]) => createSubscriptionMock(...a),
}))
vi.mock('@/lib/discord', () => ({ notifyDiscord: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendNewSignupNotification: vi.fn(() => Promise.resolve()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/confirm-email', () => ({ issueConfirmationToken: vi.fn() }))

import { createClinicForOAuthUser } from '../signup'

/** Stands in for the `select().from().where().limit()` chain. */
function membershipLookup(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  }
  return chain
}

function form({ marketingConsent = false } = {}) {
  const fd = new FormData()
  fd.set('clinicName', 'Clínica Flora')
  fd.set('phone', '11988887777')
  if (marketingConsent) {
    fd.set('marketingConsent', 'granted')
    fd.set('metaEventId', 'complete_registration:event-google')
  }
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com', name: 'A' } })
  createSelfSignupTenantMock.mockResolvedValue({ id: 'tenant-1' })
  createSubscriptionMock.mockResolvedValue({ created: true })
  executeMock.mockResolvedValue(undefined)
  updateMock.mockReturnValue({
    set: () => ({
      where: () => Promise.resolve(),
    }),
  })
  // No membership, then the free-plan lookup.
  selectMock
    .mockReturnValueOnce(membershipLookup([]))
    .mockReturnValue(membershipLookup([{ id: 'plan-free', slug: 'free', name: 'Free', priceCents: 0 }]))
})

describe('createClinicForOAuthUser does not redirect with a stale token', () => {
  it('reports success instead of redirecting after creating the clinic', async () => {
    const state = await createClinicForOAuthUser(null, form())

    expect(state).toEqual({
      success: true,
      created: true,
    })
    // The redirect is the bug. /dashboard with tenantId: null in the token is
    // bounced straight back here by middleware.
    expect(redirectMock).not.toHaveBeenCalledWith('/dashboard')
  })

  it('still creates the clinic on that path', async () => {
    await createClinicForOAuthUser(null, form())

    expect(createSelfSignupTenantMock).toHaveBeenCalledWith({
      userId: 'user-1',
      clinicName: 'Clínica Flora',
      phone: '11988887777',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('returns and persists the Meta event id when marketing consent was granted', async () => {
    const state = await createClinicForOAuthUser(null, form({ marketingConsent: true }))

    expect(state).toEqual({
      success: true,
      created: true,
      metaEventId: 'complete_registration:event-google',
    })
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('reports success on a retry rather than redirecting', async () => {
    // The user already submitted once. The clinic exists; the token does not
    // know it yet. Redirecting here was the second half of the loop.
    selectMock.mockReset()
    selectMock.mockReturnValue(membershipLookup([{ id: 'membership-1' }]))

    const state = await createClinicForOAuthUser(null, form())

    expect(state).toEqual({ success: true, created: false })
    expect(redirectMock).not.toHaveBeenCalledWith('/dashboard')
    // Nothing created twice.
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
  })

  it('still sends an unauthenticated caller to the login page', async () => {
    authMock.mockResolvedValue(null)

    await expect(createClinicForOAuthUser(null, form())).rejects.toThrow(/NEXT_REDIRECT/)
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })

  it('returns field errors without claiming success', async () => {
    const fd = new FormData()
    fd.set('clinicName', '')
    fd.set('phone', '')

    const state = await createClinicForOAuthUser(null, fd)

    expect(state?.success).toBeUndefined()
    expect(state?.error).toBeDefined()
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
  })
})

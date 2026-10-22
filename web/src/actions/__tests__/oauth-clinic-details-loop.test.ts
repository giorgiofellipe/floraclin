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
const createSelfSignupTenantMock = vi.fn()
const createSubscriptionMock = vi.fn()
const sendSignupCompleteRegistrationEventMock = vi.fn()
const headersMock = vi.fn()
const afterMock = vi.fn()
const scheduleLifecycleWelcomeMock = vi.fn()
const getClinicMembershipsMock = vi.fn()
const cookieSetMock = vi.fn()

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirectMock(p) }))
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
  cookies: async () => ({ get: () => undefined, set: (...a: unknown[]) => cookieSetMock(...a), delete: vi.fn() }),
}))
vi.mock('next/server', () => ({
  after: (task: () => unknown) => task(),
}))
vi.mock('@/lib/auth-config', () => ({ auth: () => authMock() }))
vi.mock('@/db/client', () => ({
  db: {
    select: () => selectMock(),
    update: (...a: unknown[]) => updateMock(...a),
  },
}))
vi.mock('@/db/queries/admin-tenants', () => ({
  createSelfSignupTenant: (...a: unknown[]) => createSelfSignupTenantMock(...a),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('@/db/queries/clinic-membership', () => ({
  getClinicMemberships: (...a: unknown[]) => getClinicMembershipsMock(...a),
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
vi.mock('@/lib/meta/events', () => ({
  sendSignupCompleteRegistrationEvent: (...args: unknown[]) => sendSignupCompleteRegistrationEventMock(...args),
}))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/lifecycle-sender', () => ({
  scheduleLifecycleWelcome: (...a: unknown[]) => scheduleLifecycleWelcomeMock(...a),
}))

import { createClinicForOAuthUser } from '../signup'
import { notifyDiscord } from '@/lib/discord'
import { sendNewSignupNotification } from '@/lib/email'

async function withAdminEmail<T>(run: () => Promise<T>): Promise<T> {
  const original = process.env.ADMIN_NOTIFICATION_EMAIL
  process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@floraclin.test'
  try {
    return await run()
  } finally {
    if (original === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL
    else process.env.ADMIN_NOTIFICATION_EMAIL = original
  }
}

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
  headersMock.mockResolvedValue(new Headers({
    'x-forwarded-for': '203.0.113.11',
    'user-agent': 'Vitest OAuth Browser',
  }))
  sendSignupCompleteRegistrationEventMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com', name: 'A' } })
  createSelfSignupTenantMock.mockResolvedValue({ id: 'tenant-1' })
  createSubscriptionMock.mockResolvedValue({ created: true })
  updateMock.mockReturnValue({
    set: () => ({
      where: () => Promise.resolve(),
    }),
  })
  getClinicMembershipsMock.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false })
  // The free-plan lookup.
  selectMock.mockReturnValue(membershipLookup([{ id: 'plan-free', slug: 'free', name: 'Free', priceCents: 0 }]))
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
      placeholderName: false,
    })
    expect(updateMock).not.toHaveBeenCalled()
    // The new clinic is the selected one.
    expect(cookieSetMock).toHaveBeenCalledWith('floraclin_tenant_id', 'tenant-1', expect.objectContaining({ httpOnly: true }))
  })

  it('returns and persists the Meta event id when marketing consent was granted', async () => {
    const state = await createClinicForOAuthUser(null, form({ marketingConsent: true }))

    expect(state).toEqual({
      success: true,
      created: true,
      metaEventId: 'complete_registration:event-google',
    })
    expect(updateMock).toHaveBeenCalled()
  })

  it('schedules the welcome once, for the new tenant', async () => {
    await createClinicForOAuthUser(null, form())

    expect(scheduleLifecycleWelcomeMock).toHaveBeenCalledTimes(1)
    expect(scheduleLifecycleWelcomeMock).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
  })

  it('tells the team about the Google sign-up once, as waiting for onboarding', async () => {
    await withAdminEmail(() => createClinicForOAuthUser(null, form()))

    expect(notifyDiscord).toHaveBeenCalledTimes(1)
    expect(notifyDiscord).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'signup.started',
      ownerEmail: 'a@b.com',
      method: 'google',
    }))
    expect(sendNewSignupNotification).not.toHaveBeenCalled()
  })

  it('does not schedule the welcome again when the subscription already existed', async () => {
    createSubscriptionMock.mockResolvedValue({ created: false })

    await createClinicForOAuthUser(null, form())

    expect(scheduleLifecycleWelcomeMock).not.toHaveBeenCalled()
  })

  it('reports success on a retry rather than redirecting', async () => {
    // The user already submitted once. The clinic exists; the token does not
    // know it yet. Redirecting here was the second half of the loop.
    getClinicMembershipsMock.mockResolvedValue({ liveTenantIds: ['tenant-1'], suspendedOnly: false })

    const state = await createClinicForOAuthUser(null, form())

    expect(state).toEqual({ success: true, created: false })
    expect(redirectMock).not.toHaveBeenCalledWith('/dashboard')
    // Nothing created twice.
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
    expect(scheduleLifecycleWelcomeMock).not.toHaveBeenCalled()
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

describe('createClinicForOAuthUser Meta CompleteRegistration', () => {
  it('sends the server event with the same id the browser pixel uses', async () => {
    await createClinicForOAuthUser(null, form({ marketingConsent: true }))

    expect(sendSignupCompleteRegistrationEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'complete_registration:event-google',
      email: 'a@b.com',
      phone: '11988887777',
      eventSourceUrl: expect.stringMatching(/\/signup\/clinic-details$/),
      clientIp: '203.0.113.11',
      userAgent: 'Vitest OAuth Browser',
    }))
  })

  it('does not send the server event without marketing consent', async () => {
    await createClinicForOAuthUser(null, form())

    expect(sendSignupCompleteRegistrationEventMock).not.toHaveBeenCalled()
  })
})

/**
 * One-step Google sign-up: the clinic details page creates the clinic on
 * arrival (mode=auto) and onboarding asks for the name and phone, once.
 */
function autoForm({ marketingConsent = false, clinicName }: { marketingConsent?: boolean; clinicName?: string } = {}) {
  const fd = new FormData()
  fd.set('mode', 'auto')
  if (clinicName) fd.set('clinicName', clinicName)
  if (marketingConsent) {
    fd.set('marketingConsent', 'granted')
    fd.set('metaEventId', 'complete_registration:event-auto')
  }
  return fd
}

describe('createClinicForOAuthUser on arrival (one-step Google sign-up)', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'user-1', email: 'ana@b.com', name: 'Ana Souza' } })
    getClinicMembershipsMock.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false, neverMember: true })
  })

  it('creates the clinic with a stand-in name from the Google profile and no phone', async () => {
    const state = await createClinicForOAuthUser(null, autoForm())

    expect(state).toEqual({ success: true, created: true })
    expect(createSelfSignupTenantMock).toHaveBeenCalledWith({
      userId: 'user-1',
      clinicName: 'Clínica de Ana',
      phone: null,
      placeholderName: true,
    })
    // The trial starts here, exactly as on the form path.
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1)
    expect(cookieSetMock).toHaveBeenCalledWith('floraclin_tenant_id', 'tenant-1', expect.objectContaining({ httpOnly: true }))
  })

  it('never takes the name from the request on this path', async () => {
    await createClinicForOAuthUser(null, autoForm({ clinicName: 'Injected' }))

    expect(createSelfSignupTenantMock).toHaveBeenCalledWith(expect.objectContaining({ clinicName: 'Clínica de Ana' }))
  })

  it('falls back to a neutral name when Google gave none', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', email: 'ana@b.com', name: null } })

    await createClinicForOAuthUser(null, autoForm())

    expect(createSelfSignupTenantMock).toHaveBeenCalledWith(expect.objectContaining({ clinicName: 'Minha clínica' }))
  })

  it('waits for onboarding to send the welcome, so WhatsApp is not skipped for want of a phone', async () => {
    await createClinicForOAuthUser(null, autoForm())

    expect(scheduleLifecycleWelcomeMock).not.toHaveBeenCalled()
  })

  it('tells the team who signed up, once, without the stand-in clinic name', async () => {
    await withAdminEmail(() => createClinicForOAuthUser(null, autoForm()))

    expect(notifyDiscord).toHaveBeenCalledTimes(1)
    expect(notifyDiscord).toHaveBeenCalledWith({
      kind: 'signup.started',
      tenantId: 'tenant-1',
      ownerName: 'Ana Souza',
      ownerEmail: 'ana@b.com',
      method: 'google',
      attribution: null,
    })
    expect(JSON.stringify(vi.mocked(notifyDiscord).mock.calls)).not.toContain('Clínica de Ana')
    // The admin e-mail waits for onboarding, where the real name is typed.
    expect(sendNewSignupNotification).not.toHaveBeenCalled()
  })

  it('sends CompleteRegistration once, server-side, with the id the browser pixel uses and no phone', async () => {
    const state = await createClinicForOAuthUser(null, autoForm({ marketingConsent: true }))

    expect(state).toEqual({ success: true, created: true, metaEventId: 'complete_registration:event-auto' })
    expect(sendSignupCompleteRegistrationEventMock).toHaveBeenCalledTimes(1)
    expect(sendSignupCompleteRegistrationEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'complete_registration:event-auto',
      email: 'ana@b.com',
      phone: null,
    }))
  })

  it('sends no Meta event without marketing consent', async () => {
    const state = await createClinicForOAuthUser(null, autoForm())

    expect(state).not.toHaveProperty('metaEventId')
    expect(sendSignupCompleteRegistrationEventMock).not.toHaveBeenCalled()
  })

  it('refuses for an account that was in a clinic before, so a removed staff member gets the form, not a trial', async () => {
    getClinicMembershipsMock.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false, neverMember: false })

    const state = await createClinicForOAuthUser(null, autoForm({ marketingConsent: true }))

    expect(state).toEqual({ needsDetails: true })
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
    expect(createSubscriptionMock).not.toHaveBeenCalled()
    expect(sendSignupCompleteRegistrationEventMock).not.toHaveBeenCalled()
  })

  it('never gives a platform admin a clinic unasked', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', email: 'ops@b.com', name: 'Ops' }, isPlatformAdmin: true })

    const state = await createClinicForOAuthUser(null, autoForm())

    expect(state).toEqual({ needsDetails: true })
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
  })

  it('makes no second trial, cookie or event when the clinic exists by the time the lock is held', async () => {
    // createSelfSignupTenant re-checks under a per-user lock and returns null.
    createSelfSignupTenantMock.mockResolvedValue(null)

    const state = await createClinicForOAuthUser(null, autoForm({ marketingConsent: true }))

    expect(state).toEqual({ success: true, created: false })
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(createSubscriptionMock).not.toHaveBeenCalled()
    expect(sendSignupCompleteRegistrationEventMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })
})

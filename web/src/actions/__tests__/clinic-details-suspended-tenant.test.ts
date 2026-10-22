import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Google sign-up looped on /signup/clinic-details for a user whose only clinic
 * had been suspended (soft-deleted).
 *
 * The jwt callback resolves the tenant through a join that skips soft-deleted
 * tenants, so the token said tenantId: null and middleware kept sending the
 * user to clinic details. The action looked up memberships without that join,
 * found the suspended one, answered { created: false } ("the clinic already
 * exists, just refresh the session"), and the refresh came back with no tenant
 * again. Two lookups of the same thing disagreed, and the user was stuck.
 *
 * These read the SQL drizzle actually emits (pg-proxy) and feed it rows that
 * stand for the database, so a lookup that ignores tenants.deleted_at cannot
 * pass.
 */

const capturedSql: string[] = []
const cookieSet = vi.fn()
const cookieDelete = vi.fn()
let tenantCookie: string | undefined
let isPlatformAdmin = false
const createSelfSignupTenantMock = vi.fn()

// By default one membership, in a tenant suspended on Oct 13.
const SUSPENDED = { tenantId: 'tenant-suspended', deletedAt: '2026-10-13 19:19:45.42+00' }
let memberships: { tenantId: string; deletedAt: string | null }[] = []

vi.mock('next/navigation', () => ({
  redirect: (p: string) => {
    throw new Error(`NEXT_REDIRECT:${p}`)
  },
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === 'floraclin_tenant_id' && tenantCookie ? { value: tenantCookie } : undefined),
    set: (...a: unknown[]) => cookieSet(...a),
    delete: (...a: unknown[]) => cookieDelete(...a),
  }),
}))
vi.mock('next/server', () => ({ after: (task: () => unknown) => task() }))
vi.mock('@/lib/auth-config', () => ({
  auth: async () => ({ user: { id: 'user-1', email: 'a@b.com', name: 'A' }, isPlatformAdmin }),
  signIn: vi.fn(),
}))
vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async (sql: string) => {
      capturedSql.push(sql)
      if (!sql.includes('"tenant_users"')) return { rows: [] }
      // Stand-in for Postgres: a query that filters out soft-deleted tenants
      // gets nothing back; one that reads deleted_at gets it; one that never
      // looks at tenants just sees a membership row.
      if (/"tenants"\."deleted_at" is null/.test(sql)) {
        return { rows: memberships.filter((m) => !m.deletedAt).map((m) => [m.tenantId]) }
      }
      if (/"tenants"\."deleted_at"/.test(sql)) return { rows: memberships.map((m) => [m.tenantId, m.deletedAt]) }
      return { rows: memberships.length ? [['membership-1']] : [] }
    }),
  }
})
vi.mock('@/db/queries/admin-tenants', () => ({
  createSelfSignupTenant: (...a: unknown[]) => createSelfSignupTenantMock(...a),
  findAvailableSlug: vi.fn(),
  generateSlug: (name: string) => name,
  insertSelfSignupTenantBase: vi.fn(),
}))
vi.mock('@/db/queries/subscriptions', () => ({ createSubscription: vi.fn(async () => ({ created: false })) }))
vi.mock('@/lib/discord', () => ({ notifyDiscord: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendNewSignupNotification: vi.fn(() => Promise.resolve()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/confirm-email', () => ({ issueConfirmationToken: vi.fn() }))
vi.mock('@/lib/meta/events', () => ({ sendSignupCompleteRegistrationEvent: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/lifecycle-sender', () => ({ scheduleLifecycleWelcome: vi.fn() }))

import { createClinicForOAuthUser } from '../signup'

function form() {
  const fd = new FormData()
  fd.set('clinicName', 'Clínica Nova')
  fd.set('phone', '11988887777')
  return fd
}

beforeEach(() => {
  capturedSql.length = 0
  tenantCookie = undefined
  isPlatformAdmin = false
  memberships = [SUSPENDED]
  vi.clearAllMocks()
  createSelfSignupTenantMock.mockResolvedValue({ id: 'tenant-new' })
})

describe('clinic details for a user whose only clinic is suspended', () => {
  it('does not claim the clinic already exists when the session can never see it', async () => {
    const state = await createClinicForOAuthUser(null, form())

    // created:false makes the client refresh a session that resolves no
    // tenant, then land back here: the loop.
    expect(state?.created).not.toBe(false)
    expect(state?.success).not.toBe(true)
  })

  it('says, in Portuguese, that the clinic is suspended and creates nothing', async () => {
    const state = await createClinicForOAuthUser(null, form())

    expect(state?.suspended).toBe(true)
    expect(state?.error?.general?.[0]).toMatch(/suspens/)
    expect(state?.error?.general?.[0]).toContain('contato@floraclin.com.br')
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
  })

  it('clears a tenant cookie that points at a clinic the user cannot use', async () => {
    tenantCookie = '45d53bbe-4859-44f3-9405-15f5cc581694'
    await createClinicForOAuthUser(null, form())

    expect(cookieDelete).toHaveBeenCalledWith('floraclin_tenant_id')
  })

  it('reads memberships the same way the jwt callback does, through live tenants', async () => {
    await createClinicForOAuthUser(null, form())

    const lookup = capturedSql.find((s) => s.includes('"tenant_users"'))
    expect(lookup).toMatch(/inner join "floraclin"\."tenants"/i)
    expect(lookup).toMatch(/"tenants"\."deleted_at"/)
  })
})

describe('clinic details with a stale tenant cookie', () => {
  const STALE = '45d53bbe-4859-44f3-9405-15f5cc581694'

  it('creates the clinic for a user with none, replacing the stale cookie', async () => {
    memberships = []
    tenantCookie = STALE

    const state = await createClinicForOAuthUser(null, form())

    expect(state).toMatchObject({ success: true, created: true })
    expect(createSelfSignupTenantMock).toHaveBeenCalledTimes(1)
    expect(cookieDelete).toHaveBeenCalledWith('floraclin_tenant_id')
    expect(cookieSet).toHaveBeenCalledWith('floraclin_tenant_id', 'tenant-new', expect.objectContaining({ httpOnly: true, path: '/' }))
  })

  it('sends a user with a live clinic on, even if another of theirs is suspended', async () => {
    memberships = [SUSPENDED, { tenantId: 'tenant-live', deletedAt: null }]
    tenantCookie = STALE

    const state = await createClinicForOAuthUser(null, form())

    expect(state).toEqual({ success: true, created: false })
    expect(createSelfSignupTenantMock).not.toHaveBeenCalled()
    expect(cookieDelete).toHaveBeenCalledWith('floraclin_tenant_id')
  })

  it('keeps a cookie that names one of the user\'s live clinics', async () => {
    memberships = [{ tenantId: 'tenant-live', deletedAt: null }]
    tenantCookie = 'tenant-live'

    await createClinicForOAuthUser(null, form())

    expect(cookieDelete).not.toHaveBeenCalled()
  })
  it('leaves a platform admin\'s cookie alone: it may name any clinic on purpose', async () => {
    memberships = []
    isPlatformAdmin = true
    tenantCookie = STALE

    await createClinicForOAuthUser(null, form())

    expect(cookieDelete).not.toHaveBeenCalled()
  })
})

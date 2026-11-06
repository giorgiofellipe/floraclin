import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import type { NextAuthConfig } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { db } from '@/db/client'
import { plans, tenantSubscriptions, tenants, tenantUsers, users } from '@/db/schema'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const { nextAuth, cookie } = vi.hoisted(() => ({
  nextAuth: { config: null as NextAuthConfig | null, auth: vi.fn() },
  cookie: { tenantId: undefined as string | undefined },
}))
vi.mock('next-auth', () => ({
  default: (config: NextAuthConfig) => {
    nextAuth.config = config
    return { auth: nextAuth.auth, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))
vi.mock('@/lib/analytics/server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/last-login', () => ({ rememberLastLogin: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ setUser: vi.fn(), setTags: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookie.tenantId ? { value: cookie.tenantId } : undefined), set: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))

import { getAuthContext, SESSION_REVOKED_PATH } from '../auth'
import { getClinicMemberships } from '@/db/queries/clinic-membership'

async function callbacks() {
  await import('../auth-config')
  return nextAuth.config!.callbacks!
}

async function jwtTenantId(userId: string) {
  await import('../auth-config')
  const token = (await nextAuth.config!.callbacks!.jwt!({
    token: { sub: userId } as JWT,
    trigger: 'update',
  } as never)) as JWT
  return token.tenantId
}

// Someone registers medica@clinica.com with a password of their own; the real
// clinic later invites that address, and inviteUser adds the membership to the
// existing, still unconfirmed account.
describeIntegration('an unconfirmed password account (integration, requires test DB)', () => {
  const userIds: string[] = []
  const tenantIds: string[] = []

  async function insertTenant(name: string) {
    const [row] = await db
      .insert(tenants)
      .values({ name, slug: `scope-${randomUUID()}`, status: 'active' })
      .returning({ id: tenants.id })
    tenantIds.push(row.id)
    const [free] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, 'free')).limit(1)
    if (free) {
      await db
        .insert(tenantSubscriptions)
        .values({ tenantId: row.id, planId: free.id, currentPeriodEnd: sql`now() + interval '14 days'` as never })
    }
    return row.id
  }

  async function plantAccountInvitedElsewhere(passwordHash: string | null = 'x') {
    const userId = randomUUID()
    await db.insert(users).values({ id: userId, email: `scope-${userId}@clinica.test`, fullName: 'Medica', passwordHash })
    userIds.push(userId)
    const signupTenantId = await insertTenant('Clínica do Invasor')
    const invitedTenantId = await insertTenant('Clínica Real')
    // Inserted first so a lookup without an order meets it before the signup row.
    await db.insert(tenantUsers).values({ tenantId: invitedTenantId, userId, role: 'practitioner' })
    await db.insert(tenantUsers).values({
      tenantId: signupTenantId,
      userId,
      role: 'owner',
      createdAt: sql`now() - interval '1 day'` as never,
    })
    return { userId, signupTenantId, invitedTenantId }
  }

  beforeEach(() => {
    vi.stubEnv('TEST_AUTH_BYPASS_ENABLED', 'false')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    cookie.tenantId = undefined
    const doneUsers = userIds.splice(0)
    const doneTenants = tenantIds.splice(0)
    if (doneUsers.length) await db.delete(tenantUsers).where(inArray(tenantUsers.userId, doneUsers))
    if (doneTenants.length) {
      await db.delete(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, doneTenants))
      await db.delete(tenants).where(inArray(tenants.id, doneTenants))
    }
    if (doneUsers.length) await db.delete(users).where(inArray(users.id, doneUsers))
  })

  it('reaches only the clinic it created at signup, and every membership once confirmed', async () => {
    const { userId, signupTenantId, invitedTenantId } = await plantAccountInvitedElsewhere()
    nextAuth.auth.mockResolvedValue({ user: { id: userId }, authAt: Date.now() })
    cookie.tenantId = invitedTenantId

    expect((await getAuthContext()).tenantId).toBe(signupTenantId)
    expect(await jwtTenantId(userId)).toBe(signupTenantId)

    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, userId))

    expect((await getAuthContext()).tenantId).toBe(invitedTenantId)
  })

  it('is suspended-only when its own clinic is suspended, whatever it was invited to', async () => {
    const { userId, signupTenantId } = await plantAccountInvitedElsewhere()
    await db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, signupTenantId))

    expect(await getClinicMemberships(userId)).toMatchObject({ liveTenantIds: [], suspendedOnly: true })
  })

  // An account that never had a password (Google, magic link, invited) is
  // confirmed by how it signed in, even before emailVerified is stamped.
  it('reaches every membership when the account never had a password', async () => {
    const { userId, invitedTenantId } = await plantAccountInvitedElsewhere(null)
    nextAuth.auth.mockResolvedValue({ user: { id: userId }, authAt: Date.now() })
    cookie.tenantId = invitedTenantId

    expect((await getAuthContext()).tenantId).toBe(invitedTenantId)
  })

  // Catches the real owner's sign-in discarding the planted password but
  // leaving the session whoever planted it already holds.
  it.each([
    [
      'Google',
      async (user: { id: string; email: string }) => {
        const token = (await (await callbacks()).jwt!({
          token: { sub: user.id } as JWT,
          user: { ...user, emailVerified: null },
          account: { provider: 'google', type: 'oidc', providerAccountId: 'g-1' },
          trigger: 'signIn',
        } as never)) as JWT
        return token.authAt as number
      },
    ],
    [
      'the magic link',
      async (user: { id: string; email: string }) => {
        await (await callbacks()).signIn!({
          user: { ...user, emailVerified: null },
          account: { provider: 'resend', type: 'email', providerAccountId: user.email },
        } as never)
        return Date.now()
      },
    ],
  ] as const)('revokes the planted password\'s session when the real owner signs in with %s', async (_name, ownerSignsIn) => {
    const { userId, signupTenantId } = await plantAccountInvitedElsewhere()
    const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId))
    const plantedAuthAt = Date.now() - 60_000
    nextAuth.auth.mockResolvedValue({ user: { id: userId }, authAt: plantedAuthAt })
    expect((await getAuthContext()).tenantId).toBe(signupTenantId)

    const ownerAuthAt = await ownerSignsIn({ id: userId, email })

    await expect(getAuthContext()).rejects.toThrow(`NEXT_REDIRECT:${SESSION_REVOKED_PATH}`)
    nextAuth.auth.mockResolvedValue({ user: { id: userId }, authAt: ownerAuthAt })
    await expect(getAuthContext()).resolves.toMatchObject({ userId })
    const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId))
    expect(row.passwordHash).toBeNull()
  })
})

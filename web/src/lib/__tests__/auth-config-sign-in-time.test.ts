import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextAuthConfig } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { getTableColumns } from 'drizzle-orm'
import { users } from '@/db/schema'
import { signedInBeforePasswordChange } from '../auth'

/**
 * A password change revokes sessions signed in before it, measured by `authAt`.
 * If a refresh moved `authAt` forward, an old session would outlive the change.
 */

const { userRow } = vi.hoisted(() => ({ userRow: { current: null as unknown[] | null } }))
vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return { db: drizzle(async () => ({ rows: userRow.current ? [userRow.current] : [] })) }
})
vi.mock('bcryptjs', () => ({ default: { compare: async () => true } }))

const { config } = vi.hoisted(() => ({ config: { current: null as NextAuthConfig | null } }))
vi.mock('next-auth', () => ({
  default: (c: NextAuthConfig) => {
    config.current = c
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: (c: object) => ({ id: 'credentials', ...c }) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))
vi.mock('@/lib/analytics/server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/last-login', () => ({ rememberLastLogin: vi.fn() }))

type JwtArgs = Parameters<NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>>[0]

async function jwt(args: Partial<JwtArgs> & { token: JWT }) {
  await import('../auth-config')
  return config.current!.callbacks!.jwt!(args as JwtArgs) as Promise<JWT>
}

async function authorizePassword() {
  await import('../auth-config')
  const columns = getTableColumns(users)
  const values: Record<string, unknown> = { id: 'u1', email: 'a@b.com', full_name: 'Ana', password_hash: 'hash' }
  userRow.current = Object.values(columns).map((c) => values[c.name] ?? null)
  const provider = config.current!.providers.find((p) => (p as { id?: string }).id === 'credentials') as unknown as {
    authorize: (c: Record<string, string>) => Promise<{ authAt: number } | null>
  }
  return provider.authorize({ email: 'a@b.com', password: 'senha' })
}

afterEach(() => {
  vi.useRealTimers()
  userRow.current = null
})

describe('the sign-in time on the session token', () => {
  it('is stamped at sign-in', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T12:00:00Z') })
    const token = await jwt({
      token: {},
      user: { id: 'u1', email: 'a@b.com' },
      account: { provider: 'credentials', type: 'credentials', providerAccountId: 'u1' },
    })

    expect(token.authAt).toBe(Date.parse('2026-10-24T12:00:00Z'))
  })

  // Catches a password sign-in that read a planted password just before the
  // owner's Google sign-in discarded it surviving that discard: its authAt must
  // be when authorize read the hash, not when the token was minted after bcrypt.
  it('is when the password was read for a password sign-in', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T12:00:01Z') })
    const readAt = Date.parse('2026-10-24T12:00:00Z')
    const token = await jwt({
      token: {},
      user: { id: 'u1', email: 'a@b.com', authAt: readAt } as JwtArgs['user'],
      account: { provider: 'credentials', type: 'credentials', providerAccountId: 'u1' },
    })

    expect(token.authAt).toBe(readAt)
  })

  // Catches a planted password's session surviving the owner's Google sign-in
  // when its hash was read in the same millisecond the discard stamped
  // passwordChangedAt. The Google session itself is stamped after the discard.
  it('lets a discard in the same millisecond revoke the password session, not the one that discarded', async () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    vi.useFakeTimers({ now })
    const discardedAt = new Date(now)

    const passwordSession = await authorizePassword()

    expect(signedInBeforePasswordChange(passwordSession!.authAt, discardedAt)).toBe(true)
    expect(signedInBeforePasswordChange(now, discardedAt)).toBe(false)
  })

  it('does not move when the session is refreshed', async () => {
    const authAt = Date.parse('2026-10-01T12:00:00Z')

    expect((await jwt({ token: { sub: 'u1', authAt } })).authAt).toBe(authAt)
    expect((await jwt({ token: { sub: 'u1', authAt }, trigger: 'update' })).authAt).toBe(authAt)
  })
})

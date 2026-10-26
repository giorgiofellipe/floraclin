import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextAuthConfig } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

/**
 * A password change revokes sessions signed in before it, measured by `authAt`.
 * If a refresh moved `authAt` forward, an old session would outlive the change.
 */

vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return { db: drizzle(async () => ({ rows: [] })) }
})

const { config } = vi.hoisted(() => ({ config: { current: null as NextAuthConfig | null } }))
vi.mock('next-auth', () => ({
  default: (c: NextAuthConfig) => {
    config.current = c
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))
vi.mock('@/lib/analytics/server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/last-login', () => ({ rememberLastLogin: vi.fn() }))

type JwtArgs = Parameters<NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>>[0]

async function jwt(args: Partial<JwtArgs> & { token: JWT }) {
  await import('../auth-config')
  return config.current!.callbacks!.jwt!(args as JwtArgs) as Promise<JWT>
}

afterEach(() => {
  vi.useRealTimers()
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

  it('does not move when the session is refreshed', async () => {
    const authAt = Date.parse('2026-10-01T12:00:00Z')

    expect((await jwt({ token: { sub: 'u1', authAt } })).authAt).toBe(authAt)
    expect((await jwt({ token: { sub: 'u1', authAt }, trigger: 'update' })).authAt).toBe(authAt)
  })
})

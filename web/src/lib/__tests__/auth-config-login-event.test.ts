import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextAuthConfig } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

/**
 * Signup signs the new owner in with the credentials provider, which Auth.js
 * reports as trigger 'signIn'. login_succeeded must still say is_new_user,
 * as it does for a Google signup (trigger 'signUp').
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
const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/analytics/server', () => ({ trackServerEvent }))
vi.mock('@/lib/last-login', () => ({ rememberLastLogin: vi.fn() }))

type JwtArgs = Parameters<NonNullable<NonNullable<NextAuthConfig['callbacks']>['jwt']>>[0]

// Load the module before timing callback behavior, as in the magic-link tests.
await import('../auth-config')

async function jwt(args: Partial<JwtArgs> & { token: JWT }) {
  return config.current!.callbacks!.jwt!(args as JwtArgs) as Promise<JWT>
}

const credentials = { provider: 'credentials', type: 'credentials', providerAccountId: 'u1' } as const

beforeEach(() => {
  trackServerEvent.mockClear()
})

describe('login_succeeded on a password sign-in', () => {
  it('counts the sign-in signup performs as a new user', async () => {
    await jwt({ token: {}, user: { id: 'u1', email: 'a@b.com', isNewUser: true } as JwtArgs['user'], account: credentials, trigger: 'signIn' })

    expect(trackServerEvent).toHaveBeenCalledWith('login_succeeded', expect.anything(), { method: 'email', is_new_user: true })
  })

  it('counts an ordinary password sign-in as a returning user', async () => {
    await jwt({ token: {}, user: { id: 'u1', email: 'a@b.com', isNewUser: false } as JwtArgs['user'], account: credentials, trigger: 'signIn' })

    expect(trackServerEvent).toHaveBeenCalledWith('login_succeeded', expect.anything(), { method: 'email', is_new_user: false })
  })
})

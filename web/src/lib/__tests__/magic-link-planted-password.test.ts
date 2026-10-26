import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import type { NextAuthConfig } from 'next-auth'

/**
 * A password planted on an unconfirmed account starts working once the real
 * owner uses the magic link. Drop it on the callback only: dropping it when the
 * link is merely requested would let anyone wipe a pending account's password.
 */

const captured: { sql: string; params: unknown[] }[] = []

vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params })
    return { rows: [] }
  }),
}))

const { nextAuthConfig } = vi.hoisted(() => ({ nextAuthConfig: { current: null as NextAuthConfig | null } }))
vi.mock('next-auth', () => ({
  default: (config: NextAuthConfig) => {
    nextAuthConfig.current = config
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))

type SignInArgs = Parameters<NonNullable<NonNullable<NextAuthConfig['callbacks']>['signIn']>>[0]

async function signInCallback(args: SignInArgs) {
  await import('../auth-config')
  return nextAuthConfig.current!.callbacks!.signIn!(args)
}

const magicLinkAccount = { provider: 'resend', type: 'email', providerAccountId: 'vitima@clinica.com.br' } as const

beforeEach(() => {
  captured.length = 0
})

describe('magic-link sign-in and a password planted before confirmation', () => {
  it('drops the password of a still-unconfirmed account when the link is used', async () => {
    const allowed = await signInCallback({
      user: { id: 'u1', email: 'Vitima@Clinica.com.br', emailVerified: null },
      account: magicLinkAccount,
    })

    expect(allowed).toBe(true)
    const update = captured.find(({ sql }) => sql.startsWith('update "floraclin"."users"'))
    expect(update?.sql).toMatch(/set "password_hash" = \$1 where \(lower\("floraclin"\."users"\."email"\) = \$2 and "floraclin"\."users"\."email_verified" is null\)/)
    expect(update?.params).toEqual([null, 'vitima@clinica.com.br'])
  })

  it('leaves the account alone when the link is only being requested', async () => {
    await signInCallback({
      user: { id: 'u1', email: 'vitima@clinica.com.br', emailVerified: null },
      account: magicLinkAccount,
      email: { verificationRequest: true },
    })

    expect(captured).toEqual([])
  })
})

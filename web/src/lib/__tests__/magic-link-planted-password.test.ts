import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * Anyone can register someone else's address with a password of their own.
 * The account stays unconfirmed, so that password is refused, until the real
 * owner signs in with the magic link: Auth.js then stamps emailVerified and
 * the planted password starts working. The signIn callback is the last step
 * before that stamp, so it must drop the password there, and only on the
 * callback: dropping it when the link is merely requested would let anyone
 * wipe the password of an account that is still waiting for its confirmation.
 *
 * Real drizzle through pg-proxy, because the defence is the emitted UPDATE.
 */

const captured: string[] = []

vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string) => {
    captured.push(sql)
    return { rows: [] }
  }),
}))

const { nextAuthConfig } = vi.hoisted(() => ({ nextAuthConfig: { current: null as any } }))
vi.mock('next-auth', () => ({
  default: (config: unknown) => {
    nextAuthConfig.current = config
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))

async function signInCallback(args: Record<string, unknown>) {
  await import('../auth-config')
  return nextAuthConfig.current.callbacks.signIn(args)
}

const magicLinkAccount = { provider: 'resend', type: 'email', providerAccountId: 'vitima@clinica.com.br' }

beforeEach(() => {
  captured.length = 0
})

describe('magic-link sign-in and a password planted before confirmation', () => {
  it('drops the password of a still-unconfirmed account when the link is used', async () => {
    const allowed = await signInCallback({
      user: { id: 'u1', email: 'Vitima@Clinica.com.br', emailVerified: null },
      account: magicLinkAccount,
      email: {},
    })

    expect(allowed).toBe(true)
    const update = captured.find((sql) => sql.startsWith('update "floraclin"."users"'))
    expect(update).toMatch(/"password_hash" = \$1/)
    expect(update).toMatch(/lower\("floraclin"\."users"\."email"\) = \$\d/)
    expect(update).toMatch(/"email_verified" is null/)
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

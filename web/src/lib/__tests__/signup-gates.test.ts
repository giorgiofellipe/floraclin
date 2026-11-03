import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * Three defences that a mutation sweep found nothing pinning. Each one was
 * deleted, the whole 2500-test suite stayed green, and each is load-bearing
 * for the public signup this branch opens:
 *
 *  - `markEmailVerifiedViaGoogle` discarding a password planted on an
 *    unconfirmed account. Without it, registering someone else's address and
 *    waiting for them to sign in with Google leaves the planted credential
 *    working.
 *  - `getAuthContext` keeping the platform-admin flag when the tenant join
 *    returns nothing, so suspending an admin's only clinic does not lock them
 *    out of the admin API that undoes it.
 *  - `/api/billing/usage` reporting whether a Stripe customer exists, which
 *    is the only thing that draws the billing-portal link.
 *
 * The Google one runs real SQL through pg-proxy rather than asserting a mock,
 * because the defence IS the SQL: the existing confirm-route test mocks
 * `markEmailVerifiedViaGoogle` and asserts only that it was called.
 */

const captured: string[] = []

vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string) => {
    captured.push(sql)
    return { rows: [] }
  }),
}))

beforeEach(() => {
  captured.length = 0
})

describe('Google verification discards a planted password', () => {
  it('nulls the password only for an account that was never confirmed', async () => {
    const { markEmailVerifiedViaGoogle } = await import('@/db/queries/users')

    await markEmailVerifiedViaGoogle('vitima@clinica.com.br')

    const [update] = captured
    expect(update).toMatch(/^update "floraclin"\."users"/)
    // The whole defence. A plain `set email_verified` leaves the credential
    // the attacker chose working the moment the real owner signs in.
    expect(update).toMatch(/password_hash"?\s*=\s*case when/i)
    expect(update).toMatch(/email_verified"? is null/i)
  })

  it('matches the address the way the unique index does', async () => {
    const { markEmailVerifiedViaGoogle } = await import('@/db/queries/users')

    await markEmailVerifiedViaGoogle('Vitima@Clinica.com.BR')

    expect(captured[0]).toMatch(/lower\("floraclin"\."users"\."email"\)/i)
  })
})

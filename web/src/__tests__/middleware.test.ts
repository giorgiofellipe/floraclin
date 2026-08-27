import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Middleware had no test at all before this change, which is uncomfortable
 * for the file that decides who gets into the app.
 *
 * The cases below are the ones that would take production down rather than
 * merely misbehave. Two of them are lockouts that nearly shipped:
 *
 *   - A token minted before `emailVerified` existed carries `undefined`. The
 *     session used to coerce that to `false`, which would have redirected
 *     every already-logged-in customer to /confirm-email, forever, with no
 *     email to click because none was ever sent to them.
 *
 *   - The stale-token check clears anything below the current version. It has
 *     to move in step with the version the JWT callback mints, or old tokens
 *     survive without the new claim and hit the case above.
 */

// `auth` is used as a higher-order wrapper: `export default auth((req) => ...)`.
// Returning the handler unchanged lets the tests call it with a synthetic
// request, without standing up Auth.js.
vi.mock('@/lib/auth-config', () => ({
  auth: (handler: unknown) => handler,
}))

import middleware from '../middleware'

const TOKEN_VERSION = 3

function req(pathname: string, session: Record<string, unknown> | null) {
  return {
    nextUrl: new URL(`https://app.floraclin.com.br${pathname}`),
    url: `https://app.floraclin.com.br${pathname}`,
    method: 'GET',
    headers: new Headers(),
    auth: session,
    cookies: { delete: vi.fn() },
  } as never
}

function session(over: Record<string, unknown> = {}) {
  return {
    v: TOKEN_VERSION,
    tenantId: 'tenant-1',
    tenantStatus: 'active',
    subscriptionStatus: 'active',
    emailVerified: true,
    ...over,
  }
}

function locationOf(res: { headers: Headers } | undefined) {
  return res?.headers?.get('location') ?? null
}

/** Auth.js's wrapper takes (req, ctx); the handler ignores ctx. */
function run(pathname: string, s: Record<string, unknown> | null) {
  return (middleware as unknown as (r: unknown, c: unknown) => { headers: Headers })(
    req(pathname, s),
    {},
  )
}

beforeEach(() => vi.clearAllMocks())

describe('middleware: email confirmation gate', () => {
  it('sends an unconfirmed user to /confirm-email', () => {
    const res = run('/dashboard', session({ emailVerified: false }))
    expect(locationOf(res)).toContain('/confirm-email')
  })

  it('lets an unconfirmed user reach /confirm-email itself', () => {
    const res = run('/confirm-email', session({ emailVerified: false }))
    expect(locationOf(res)).toBeNull()
  })

  it('lets a confirmed user through', () => {
    const res = run('/dashboard', session({ emailVerified: true }))
    expect(locationOf(res)).toBeNull()
  })

  it('does NOT gate a token that predates the claim', () => {
    // The lockout that nearly shipped. `emailVerified` absent must mean
    // "unknown", never "unverified": every existing customer's token looked
    // exactly like this.
    const s = session()
    delete (s as Record<string, unknown>).emailVerified
    const res = run('/dashboard', s)
    expect(locationOf(res) ?? '').not.toContain('/confirm-email')
  })
})

describe('middleware: stale tokens', () => {
  it('clears a token older than the current version', () => {
    // Must track the version the JWT callback mints. If it lags, old tokens
    // survive without the new claim and fall into the case above.
    const res = run('/dashboard', session({ v: TOKEN_VERSION - 1 }))
    expect(locationOf(res)).toContain('/login')
  })
})

describe('middleware: API routes are not gated here', () => {
  it('passes API requests through untouched', () => {
    // Write enforcement lives in requireWrite, against the database and the
    // caller's real tenant. Middleware only sees a JWT that refreshes on
    // sign-in and carries an arbitrary first membership, so gating writes
    // here would enforce nothing for an already-logged-in user.
    const res = run('/api/patients', session({ subscriptionStatus: 'expired' }))
    expect(locationOf(res)).toBeNull()
  })

  it('passes unauthenticated webhook requests through', () => {
    const res = run('/api/webhooks/whatsapp', null)
    expect(locationOf(res)).toBeNull()
  })
})

describe('middleware: the approval gate is gone', () => {
  it('never redirects to /pending-approval', () => {
    for (const status of ['active', 'pending_approval', 'suspended']) {
      const res = run('/dashboard', session({ tenantStatus: status }))
      expect(locationOf(res) ?? '').not.toContain('/pending-approval')
    }
  })
})

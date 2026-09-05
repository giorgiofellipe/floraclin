import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Suspension is the only lever against abuse now that anyone can sign up, and
 * it did not revoke anything.
 *
 * `suspendTenant` soft-deletes the tenant row and leaves the memberships and
 * the subscription alone. `getAuthContext` read memberships without looking at
 * the tenant, and `subscriptionGate` only inspects the subscription, so a
 * suspended clinic kept every API it had: still owner, still paid, still
 * writing. Only the next sign-in cut it off, because the jwt callback does
 * join the tenant.
 *
 * These assert the join is part of the query the API path uses. They read the
 * built SQL rather than mocking a result set: a mocked `select()` returns
 * whatever it is told and would pass with the join deleted.
 */

const capturedSql: string[] = []

vi.mock('@/lib/auth-config', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {} })),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))

vi.mock('@/db/client', async () => {
  // pg-proxy hands every built query to a callback instead of a connection,
  // so the test sees the SQL drizzle actually emits. Nothing here can invent
  // a join the query does not have.
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async (sql: string) => {
      capturedSql.push(sql)
      return { rows: [] }
    }),
  }
})

import { getAuthContext, getUserTenants } from '@/lib/auth'

beforeEach(() => {
  capturedSql.length = 0
})

describe('a suspended tenant loses API access, not just page access', () => {
  it('the membership lookup joins tenants and excludes soft-deleted ones', async () => {
    // No memberships come back, so it redirects. The query is what matters.
    await expect(getAuthContext()).rejects.toThrow(/NEXT_REDIRECT/)

    const membershipQuery = capturedSql.find((s) => s.includes('tenant_users'))
    expect(membershipQuery, 'getAuthContext never queried tenant_users').toBeDefined()
    expect(membershipQuery).toMatch(/join .*"?tenants"?/i)
    expect(
      membershipQuery,
      'the tenant is joined but its deletion is not checked, so suspension does nothing here',
    ).toMatch(/deleted_at"? is null/i)
  })

  it('the tenant switcher does not offer a suspended clinic', async () => {
    // Listing one would be a dead end: picking it lands on getAuthContext,
    // which now finds no membership and bounces to /login.
    await getUserTenants('user-1')

    const query = capturedSql.find((s) => s.includes('tenant_users'))
    expect(query).toBeDefined()
    expect(query).toMatch(/deleted_at"? is null/i)
  })
})

describe('a platform admin is not locked out by the same join', () => {
  it('falls back to the user row when no live membership remains', async () => {
    // Suspending an admin's only clinic empties the membership join. Without
    // this fallback the admin flag goes false, getAuthContext redirects to
    // /login, and the admin API that undoes the suspension is unreachable.
    await expect(getAuthContext()).rejects.toThrow(/NEXT_REDIRECT/)

    const userLookup = capturedSql.find(
      (s) => s.includes('is_platform_admin') && !s.includes('tenant_users'),
    )
    expect(
      userLookup,
      'no user-row lookup ran, so the admin flag came only from the join',
    ).toBeDefined()
  })
})

import type { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { subscriptionGate } from '@/lib/plans'
import type { AuthContext, Role } from '@/types'

/**
 * Role plus subscription, for any route that mutates tenant data.
 *
 * Deliberately not middleware, for three concrete reasons:
 *
 * 1. The JWT cannot enforce expiry. It refreshes only on sign-in or an
 *    explicit `session.update()` (the jwt callback), while the expiry cron
 *    and the Stripe webhook write the subscription straight to the DB. An
 *    already-logged-in user would keep a stale `trialing` claim and keep
 *    writing indefinitely.
 * 2. The JWT carries the wrong tenant for this check. It takes an arbitrary
 *    first membership via `.limit(1)` (that same callback), while routes act
 *    on the active tenant resolved from the `floraclin_tenant_id` cookie. A
 *    user with two clinics would be judged against the wrong one.
 * 3. Middleware has no notion of platform admins, who `subscriptionGate`
 *    explicitly exempts.
 *
 * `subscriptionGate` reads the DB for the caller's real active tenant and
 * exempts platform admins, so this wrapper does too.
 *
 * Returns either a context to proceed with, or a response to return as-is.
 */
export async function requireWrite(
  ...roles: Role[]
): Promise<{ ctx: AuthContext; blocked: null } | { ctx: null; blocked: NextResponse }> {
  const ctx = await requireRole(...roles)
  const blocked = await subscriptionGate(ctx)
  if (blocked) return { ctx: null, blocked }
  return { ctx, blocked: null }
}

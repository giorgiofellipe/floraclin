import { NextResponse } from 'next/server'
import { and, asc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantUsers, users } from '@/db/schema'
import type { AuthContext } from '@/types'

/**
 * What an owner who signed up with a password may do before confirming the
 * address.
 *
 * They get in straight away: onboarding, patients, agenda, records, finances
 * and settings all work. What stays behind the confirmation is what reaches
 * someone else on the account's word: WhatsApp messages (on FloraClin's shared
 * number, to any phone typed in), team invites (an e-mail to any address) and
 * checkout (a Stripe customer under an address nobody has proven). Those are
 * the levers an account registered with someone else's address could pull.
 *
 * Accounts that never had a password (Google, magic link, invited members)
 * are confirmed by how they signed in, so only `password set, not confirmed`
 * counts as awaiting confirmation.
 */
export const EMAIL_CONFIRMATION_REQUIRED = {
  body: {
    error: 'Confirme seu e-mail para liberar esta ação. Enviamos o link para a sua caixa de entrada.',
    code: 'email_unconfirmed',
  },
  status: 403,
} as const

export class EmailConfirmationRequiredError extends Error {
  constructor() {
    super(EMAIL_CONFIRMATION_REQUIRED.body.error)
    this.name = 'EmailConfirmationRequiredError'
  }
}

export function emailConfirmationRequiredResponse(): NextResponse {
  return NextResponse.json(EMAIL_CONFIRMATION_REQUIRED.body, { status: EMAIL_CONFIRMATION_REQUIRED.status })
}

/** Route gate for the signed-in user's own address: the 403 response, or null to proceed. */
export function emailConfirmationGate(ctx: Pick<AuthContext, 'emailVerified' | 'isPlatformAdmin'>): NextResponse | null {
  if (ctx.isPlatformAdmin || ctx.emailVerified !== false) return null
  return emailConfirmationRequiredResponse()
}

/**
 * Whether the clinic's owner (the first active one, as the lifecycle and
 * reminder queries pick it) signed up with a password and has not confirmed
 * the address yet. For sends that run without a signed-in user (crons, queue
 * drains) as much as for those that do.
 */
export async function isTenantAwaitingEmailConfirmation(tenantId: string): Promise<boolean> {
  const [owner] = await db
    .select({ emailVerified: users.emailVerified, passwordHash: users.passwordHash })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner'), eq(tenantUsers.isActive, true)))
    .orderBy(asc(tenantUsers.createdAt))
    .limit(1)
  return !!owner && owner.passwordHash !== null && owner.emailVerified === null
}

/** Throws EmailConfirmationRequiredError while the clinic's owner has not confirmed the address. */
export async function requireTenantEmailConfirmed(tenantId: string): Promise<void> {
  if (await isTenantAwaitingEmailConfirmation(tenantId)) throw new EmailConfirmationRequiredError()
}

/**
 * Over tenant_users joined to users: until a password account confirms its
 * address, only the membership created with its signup (its first) counts.
 * Whoever registered someone else's address must not inherit that person's
 * later invites (inviteUser adds them to the existing account).
 */
export function membershipUsableBeforeConfirmation(): SQL {
  return sql`(
    ${users.passwordHash} is null
    or ${users.emailVerified} is not null
    or ${tenantUsers.id} = (
      select signup.id from ${tenantUsers} signup
      where signup.user_id = ${tenantUsers.userId}
      order by signup.created_at asc, signup.id asc
      limit 1
    )
  )`
}

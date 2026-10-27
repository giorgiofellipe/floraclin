import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { eq, and, gt, isNull, lt, or, sql } from 'drizzle-orm'
import crypto from 'crypto'
import { CONFIRM_TOKEN_TTL_MS } from '@/lib/confirm-email-page-state'
import { getAppUrl } from '@/lib/app-url'

/**
 * Confirmation tokens share `verification_tokens` with password reset
 * tokens, keyed by identifier. reset-request deletes every row for an
 * identifier before inserting a new one (reset-request/route.ts). If
 * confirmation used the bare email as identifier, a password reset
 * requested mid-signup would silently delete the pending confirmation
 * and strand the account with no visible error. Namespacing keeps the
 * two token kinds from ever sharing a row.
 */
export function confirmIdentifier(email: string): string {
  return `confirm:${email.toLowerCase()}`
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Derived from the row instead of random, so a reminder can resend the link
 * already in the inbox without invalidating it. Only the hash is stored.
 */
function rawTokenFor(identifier: string, expires: Date): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set')
  return crypto.createHmac('sha256', secret).update(`${identifier}:${expires.getTime()}`).digest('hex')
}

export function confirmEmailUrl(email: string, rawToken: string): string {
  return `${getAppUrl()}/api/auth/confirm?email=${encodeURIComponent(email)}&token=${rawToken}`
}

/**
 * Issues a token, atomically.
 *
 * An upsert rather than delete-then-insert: the delete left a window in which
 * a concurrent resend saw no row, concluded there was nothing to throttle
 * against, and sent a second email. Keyed on the partial unique index over
 * `identifier` added in 0023.
 *
 * `cooldownMs` makes the throttle part of the same statement. When supplied,
 * the update only fires if the existing row is older than the cooldown, so
 * two simultaneous callers cannot both win. Returns null when throttled.
 * Signup omits it: there is nothing to throttle on a brand new account.
 */
export async function issueConfirmationToken(
  email: string,
  cooldownMs?: number,
): Promise<string | null> {
  const identifier = confirmIdentifier(email)
  const now = new Date()
  const expires = new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS)
  const raw = rawTokenFor(identifier, expires)

  const rows = await db
    .insert(verificationTokens)
    .values({
      identifier,
      token: hashToken(raw),
      expires,
      lastSentAt: now,
    })
    .onConflictDoUpdate({
      target: verificationTokens.identifier,
      // The unique index behind this is PARTIAL (see 0023). Postgres only
      // infers a partial index as the ON CONFLICT arbiter when the clause
      // repeats its predicate; without this it raises 42P10 and every signup
      // and resend throws. Drizzle emits the predicate only when targetWhere
      // is passed.
      targetWhere: sql`${verificationTokens.identifier} like 'confirm:%'`,
      set: {
        token: hashToken(raw),
        expires,
        lastSentAt: now,
      },
      setWhere: cooldownMs
        ? or(
            isNull(verificationTokens.lastSentAt),
            lt(verificationTokens.lastSentAt, new Date(now.getTime() - cooldownMs)),
          )
        : undefined,
    })
    .returning({ identifier: verificationTokens.identifier })

  return rows.length > 0 ? raw : null
}

/**
 * Rebuilds the outstanding link instead of rotating it, so a reminder never
 * kills the link in an earlier email. A link a password change revoked is
 * replaced, since confirmEmailWithToken would refuse it.
 */
export async function getOrIssueConfirmationUrl(email: string): Promise<string> {
  const identifier = confirmIdentifier(email)
  const [row] = await db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        gt(verificationTokens.expires, new Date()),
        sql`not exists (
          select 1 from ${users}
          where lower(${users.email}) = ${email.toLowerCase()}
            and ${users.passwordChangedAt} > ${verificationTokens.lastSentAt}
        )`,
      ),
    )
    .limit(1)

  if (row) return confirmEmailUrl(email, rawTokenFor(identifier, row.expires))
  // Without a cooldown the upsert always writes, so this is never null.
  return confirmEmailUrl(email, (await issueConfirmationToken(email))!)
}

export interface ConfirmedUser {
  id: string
  email: string
  name: string
}

/**
 * Consumes the token and verifies the address in one statement, so two
 * concurrent clicks cannot both pass and the side effects fire once.
 *
 * A token sent before the last password change is refused: a reset is how
 * the owner takes back an address someone else registered.
 */
export async function confirmEmailWithToken(email: string, rawToken: string): Promise<ConfirmedUser | null> {
  const rows = await db.execute<{ id: string; email: string; full_name: string }>(sql`
    with consumed as (
      delete from ${verificationTokens}
      where ${verificationTokens.identifier} = ${confirmIdentifier(email)}
        and ${verificationTokens.token} = ${hashToken(rawToken)}
        and ${verificationTokens.expires} > now()
      returning ${verificationTokens.lastSentAt} as last_sent_at
    )
    update ${users}
    set email_verified = now()
    from consumed
    where lower(${users.email}) = ${email.toLowerCase()}
      and (${users.passwordChangedAt} is null or ${users.passwordChangedAt} <= consumed.last_sent_at)
    returning ${users.id}, ${users.email}, ${users.fullName}
  `)

  const [user] = rows
  return user ? { id: user.id, email: user.email, name: user.full_name } : null
}

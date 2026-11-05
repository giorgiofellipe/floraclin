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

/** The raw token behind a stored row, or null when it was issued under another NEXTAUTH_SECRET. */
function rebuiltToken(identifier: string, row: { expires: Date; token: string }): string | null {
  const raw = rawTokenFor(identifier, row.expires)
  return hashToken(raw) === row.token ? raw : null
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
 * A link that still has at least this long to live is resent as is rather
 * than replaced, so the button in an earlier email keeps working.
 */
export const MIN_LINK_VALIDITY_MS = 6 * 60 * 60 * 1000

/**
 * The outstanding link, unless a password change revoked it (the same rule
 * confirmEmailWithToken applies), since that link would be refused.
 */
function linkNotRevoked(email: string) {
  return sql`not exists (
    select 1 from ${users}
    where lower(${users.email}) = ${email.toLowerCase()}
      and ${users.passwordChangedAt} is not null
      and (${verificationTokens.lastSentAt} is null or ${users.passwordChangedAt} > ${verificationTokens.lastSentAt})
  )`
}

/**
 * Rebuilds the outstanding link instead of rotating it, so a resend never
 * kills the link in an earlier email (unless it has under `minRemainingMs`
 * left, or a password change revoked it, in which case a new one is issued).
 *
 * With `cooldownMs` the call is a throttled resend and returns null when the
 * last send is more recent than that. Reusing the link stamps `lastSentAt`
 * in the same conditional UPDATE, so two simultaneous callers cannot both
 * pass; the fallback issue carries the same cooldown.
 */
export async function getOrIssueConfirmationUrl(email: string, minRemainingMs?: number): Promise<string>
export async function getOrIssueConfirmationUrl(
  email: string,
  minRemainingMs: number,
  cooldownMs: number,
): Promise<string | null>
export async function getOrIssueConfirmationUrl(
  email: string,
  minRemainingMs = 0,
  cooldownMs?: number,
): Promise<string | null> {
  const identifier = confirmIdentifier(email)
  const outstanding = and(
    eq(verificationTokens.identifier, identifier),
    // A link about to lapse is replaced: a reminder whose button dies
    // minutes after it arrives is no reminder.
    gt(verificationTokens.expires, new Date(Date.now() + minRemainingMs)),
    linkNotRevoked(email),
  )

  if (cooldownMs === undefined) {
    const [row] = await db
      .select({ expires: verificationTokens.expires, token: verificationTokens.token })
      .from(verificationTokens)
      .where(outstanding)
      .limit(1)
    const reusable = row && rebuiltToken(identifier, row)
    if (reusable) return confirmEmailUrl(email, reusable)
    // Without a cooldown the upsert always writes, so this is never null.
    return confirmEmailUrl(email, (await issueConfirmationToken(email))!)
  }

  const now = new Date()
  const [reused] = await db
    .update(verificationTokens)
    .set({ lastSentAt: now })
    .where(
      and(
        outstanding,
        or(
          isNull(verificationTokens.lastSentAt),
          lt(verificationTokens.lastSentAt, new Date(now.getTime() - cooldownMs)),
        ),
      ),
    )
    .returning({ expires: verificationTokens.expires, token: verificationTokens.token })
  if (reused) {
    // This update already took the cooldown slot, so the replacement is issued without one.
    const raw = rebuiltToken(identifier, reused) ?? (await issueConfirmationToken(email))!
    return confirmEmailUrl(email, raw)
  }

  // Either throttled (the upsert's cooldown refuses it too) or there is no
  // live link to reuse.
  const raw = await issueConfirmationToken(email, cooldownMs)
  return raw ? confirmEmailUrl(email, raw) : null
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

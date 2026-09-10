import { db } from '@/db/client'
import { verificationTokens } from '@/db/schema'
import { eq, and, isNull, lt, or, sql } from 'drizzle-orm'
import crypto from 'crypto'

/**
 * A password reset gets 1 hour because the user is actively waiting on
 * it right after clicking "forgot password". A confirmation link is
 * first contact after signup and is often read the next morning, not
 * within minutes, so it gets a longer window.
 */
export const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

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
  const raw = crypto.randomBytes(32).toString('hex')
  const identifier = confirmIdentifier(email)
  const now = new Date()

  const rows = await db
    .insert(verificationTokens)
    .values({
      identifier,
      token: hashToken(raw),
      expires: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
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
        expires: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
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
 * Deletes and returns the matching row in one statement, the same
 * pattern reset-confirm uses (reset-confirm/route.ts). A SELECT
 * followed by a DELETE would let two concurrent clicks both pass the
 * check before either delete lands, firing verification side effects
 * twice. With DELETE ... RETURNING, only one concurrent caller can ever
 * get the row back.
 */
export async function consumeConfirmationToken(email: string, rawToken: string): Promise<string | null> {
  const identifier = confirmIdentifier(email)
  const hashedToken = hashToken(rawToken)

  const [tokenRow] = await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, hashedToken)))
    .returning()

  if (!tokenRow) {
    return null
  }

  // Expiry is checked on the row that was already deleted, not before
  // deleting it, so an expired token is still consumed and cannot be
  // replayed after its window closes.
  if (new Date() > tokenRow.expires) {
    return null
  }

  return email.toLowerCase()
}


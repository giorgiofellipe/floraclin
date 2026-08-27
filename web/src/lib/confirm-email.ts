import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
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

export async function issueConfirmationToken(email: string): Promise<string> {
  const identifier = confirmIdentifier(email)
  const rawToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS)

  // Clear any previous confirmation token for this identifier so a
  // resend invalidates the earlier link instead of leaving two live ones.
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier))

  await db.insert(verificationTokens).values({
    identifier,
    token: hashToken(rawToken),
    expires,
    lastSentAt: new Date(),
  })

  // Only the hash is stored; the raw token is returned once, for the email link.
  return rawToken
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

export async function markEmailVerified(email: string): Promise<void> {
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.email, email.toLowerCase()))
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, verificationTokens, tenantUsers, tenants } from '@/db/schema'
import { eq, and, or, isNull, lt } from 'drizzle-orm'
import { confirmIdentifier, issueConfirmationToken } from '@/lib/confirm-email'
import { sendConfirmationEmail } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import { handleApiError } from '@/lib/api-error'

/**
 * One resend per 60 seconds per identifier. Vercel runs several instances of
 * this route concurrently, so the gate has to be a single conditional
 * UPDATE, not a read followed by a write: a read-then-write lets two
 * instances both pass the check before either commits, and both send an
 * email.
 */
const RESEND_COOLDOWN_MS = 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'E-mail é obrigatório' }, { status: 400 })
    }
    const normalizedEmail = email.toLowerCase()

    // An anonymous caller must not be able to learn which addresses have
    // accounts, or which of those are already verified. Every one of those
    // cases gets the exact same response, and none of them sends anything.
    const [user] = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)

    if (!user || user.emailVerified) {
      return NextResponse.json({ success: true })
    }

    const identifier = confirmIdentifier(normalizedEmail)
    const cooldownCutoff = new Date(Date.now() - RESEND_COOLDOWN_MS)

    const claimed = await db
      .update(verificationTokens)
      .set({ lastSentAt: new Date() })
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          or(isNull(verificationTokens.lastSentAt), lt(verificationTokens.lastSentAt, cooldownCutoff))
        )
      )
      .returning({ identifier: verificationTokens.identifier })

    if (claimed.length === 0) {
      // The conditional UPDATE above already is the throttle gate -- only
      // one caller can win it inside a 60s window, race or not. This read
      // only decides which message comes back: a pending token row that
      // just didn't clear its cooldown, versus no row at all (nothing to
      // throttle against yet), so a race here can't let two callers bypass
      // the cooldown.
      const [existing] = await db
        .select({ identifier: verificationTokens.identifier })
        .from(verificationTokens)
        .where(eq(verificationTokens.identifier, identifier))
        .limit(1)

      if (existing) {
        return NextResponse.json({ error: 'Aguarde um pouco antes de solicitar outro link.' }, { status: 429 })
      }
    }

    const [membership] = await db
      .select({ tenantName: tenants.name })
      .from(tenantUsers)
      .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
      .where(and(eq(tenantUsers.userId, user.id), eq(tenantUsers.isActive, true)))
      .limit(1)

    const appUrl = getAppUrl()
    const rawToken = await issueConfirmationToken(normalizedEmail)
    const confirmUrl = `${appUrl}/api/auth/confirm?email=${encodeURIComponent(normalizedEmail)}&token=${rawToken}`
    await sendConfirmationEmail(normalizedEmail, confirmUrl, membership?.tenantName ?? 'FloraClin')

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

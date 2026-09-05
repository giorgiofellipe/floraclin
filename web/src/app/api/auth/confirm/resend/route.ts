import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, tenantUsers, tenants } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { issueConfirmationToken } from '@/lib/confirm-email'
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
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1)

    if (!user || user.emailVerified) {
      return NextResponse.json({ success: true })
    }

    // One atomic upsert does both the throttle and the issue. The previous
    // shape claimed the row, then deleted it while re-issuing, which left a
    // window where a concurrent caller found no row, concluded there was
    // nothing to throttle against, and sent a second email.
    const rawToken = await issueConfirmationToken(normalizedEmail, RESEND_COOLDOWN_MS)

    // Throttled. Same response as every other case on purpose: a 429 here
    // would say "this address has an unconfirmed account", which is exactly
    // the fact an anonymous caller must not be able to probe for.
    if (!rawToken) {
      return NextResponse.json({ success: true })
    }

    const [membership] = await db
      .select({ tenantName: tenants.name })
      .from(tenantUsers)
      .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
      .where(and(eq(tenantUsers.userId, user.id), eq(tenantUsers.isActive, true)))
      .limit(1)

    const appUrl = getAppUrl()
    const confirmUrl = `${appUrl}/api/auth/confirm?email=${encodeURIComponent(normalizedEmail)}&token=${rawToken}`
    await sendConfirmationEmail(normalizedEmail, confirmUrl, membership?.tenantName ?? 'FloraClin')

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

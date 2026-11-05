import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, tenantUsers, tenants } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getOrIssueConfirmationUrl, MIN_LINK_VALIDITY_MS } from '@/lib/confirm-email'
import { CONFIRM_RESEND_COOLDOWN_MS } from '@/lib/confirm-resend-cooldown'
import { sendConfirmationEmail } from '@/lib/email'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'
import { membershipUsableBeforeConfirmation } from '@/lib/email-confirmation-gate'

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

    // Resends the link already in the inbox rather than rotating it: a new
    // token would kill the button in every earlier email, and the owner may
    // well click the older one. The throttle is part of the same conditional
    // write, so two instances cannot both pass it and send twice.
    const confirmUrl = await getOrIssueConfirmationUrl(normalizedEmail, MIN_LINK_VALIDITY_MS, CONFIRM_RESEND_COOLDOWN_MS)

    // Throttled. Same response as every other case on purpose: a 429 here
    // would say "this address has an unconfirmed account", which is exactly
    // the fact an anonymous caller must not be able to probe for.
    if (!confirmUrl) {
      return NextResponse.json({ success: true })
    }

    const [membership] = await db
      .select({ tenantName: tenants.name })
      .from(tenantUsers)
      .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(and(eq(tenantUsers.userId, user.id), eq(tenantUsers.isActive, true), membershipUsableBeforeConfirmation()))
      .limit(1)

    try {
      await sendConfirmationEmail(normalizedEmail, confirmUrl, membership?.tenantName ?? 'FloraClin')
    } catch (err) {
      reportSideEffectFailure(err, { area: 'signup', step: 'resend_confirmation' })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

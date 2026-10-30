import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { clearFeedbackDiscount, getSubscription, grantFeedbackDiscount } from '@/db/queries/subscriptions'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'
import { FEEDBACK_INELIGIBLE_MESSAGES, feedbackIneligibility } from '@/lib/feedback-eligibility'

/** Flags the tenant: its next checkout gets the feedback reward coupon. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { tenantId } = await params

    const existing = await getSubscription(tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Same rule checkout applies: a flag it would ignore only misleads.
    const ineligible = feedbackIneligibility(existing)
    if (ineligible) {
      return NextResponse.json(
        { error: FEEDBACK_INELIGIBLE_MESSAGES[ineligible], code: `feedback_discount_${ineligible}` },
        { status: 409 },
      )
    }

    // Already flagged: keep the original grant (who and when).
    if (existing.feedbackDiscountGrantedAt) {
      return NextResponse.json({ data: existing })
    }

    const result = await grantFeedbackDiscount(tenantId, ctx.userId)
    if (!result) {
      // Flagged concurrently; nothing to record twice.
      return NextResponse.json({ data: await getSubscription(tenantId) })
    }

    await createAuditLog({
      tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'subscription',
      entityId: existing.id,
      changes: {
        feedbackDiscountGrantedAt: { old: null, new: result.feedbackDiscountGrantedAt },
        feedbackDiscountGrantedBy: { old: null, new: ctx.userId },
      },
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return handleApiError(error, req)
  }
}

/** Clears the flag. Always allowed; a no-op when it was not set. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { tenantId } = await params

    const existing = await getSubscription(tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const result = await clearFeedbackDiscount(tenantId)
    if (!result) {
      return NextResponse.json({ data: existing })
    }

    await createAuditLog({
      tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'subscription',
      entityId: existing.id,
      changes: {
        feedbackDiscountGrantedAt: { old: existing.feedbackDiscountGrantedAt, new: null },
        feedbackDiscountGrantedBy: { old: existing.feedbackDiscountGrantedBy, new: null },
      },
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return handleApiError(error, req)
  }
}

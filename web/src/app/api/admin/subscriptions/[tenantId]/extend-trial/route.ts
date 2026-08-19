import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { extendTrial, getSubscription } from '@/db/queries/subscriptions'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { tenantId } = await params

    const body = await req.json()
    const { days } = body as { days: number }

    if (!days || days < 1) {
      return NextResponse.json({ error: 'days (>= 1) required' }, { status: 400 })
    }

    const existing = await getSubscription(tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (existing.status !== 'trialing') {
      return NextResponse.json({ error: 'Only trialing subscriptions can be extended' }, { status: 400 })
    }

    const result = await extendTrial(tenantId, days)
    if (!result) {
      return NextResponse.json({ error: 'Extend trial failed' }, { status: 500 })
    }

    await createAuditLog({
      tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'subscription',
      entityId: existing.id,
      changes: {
        trialExtendedDays: { old: 0, new: days },
        currentPeriodEnd: { old: existing.currentPeriodEnd, new: result.currentPeriodEnd },
      },
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return handleApiError(error, req)
  }
}

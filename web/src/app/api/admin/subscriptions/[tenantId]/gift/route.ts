import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { getPlanBySlug, giftSubscription, getSubscription } from '@/db/queries/subscriptions'
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
    const { planSlug, months, notes } = body as {
      planSlug: string
      months: number
      notes?: string
    }

    if (!planSlug || !months || months < 1) {
      return NextResponse.json({ error: 'planSlug and months (>= 1) required' }, { status: 400 })
    }

    const plan = await getPlanBySlug(planSlug)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const existing = await getSubscription(tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const result = await giftSubscription(tenantId, plan.id, months, ctx.userId, notes)
    if (!result) {
      return NextResponse.json({ error: 'Gift failed' }, { status: 500 })
    }

    await createAuditLog({
      tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'subscription',
      entityId: existing.id,
      changes: {
        source: { old: existing.source, new: 'gift' },
        plan: { old: existing.plan.slug, new: planSlug },
        giftedMonths: { old: existing.giftedMonths, new: months },
        ...(notes ? { notes: { old: existing.notes, new: notes } } : {}),
      },
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    return handleApiError(error, req)
  }
}

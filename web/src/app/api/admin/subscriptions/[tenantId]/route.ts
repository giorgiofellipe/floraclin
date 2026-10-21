import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import {
  getSubscription,
  getPlanBySlug,
  updateSubscriptionPeriod,
  updateSubscriptionPlan,
  updateSubscriptionStatus,
} from '@/db/queries/subscriptions'
import { grantNeedsNewEnd } from '@/lib/subscription-access'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { tenantId } = await params

    const subscription = await getSubscription(tenantId)
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const creditUsage = await getCreditUsage(tenantId)

    return NextResponse.json({ data: { ...subscription, creditUsage } })
  } catch (error) {
    return handleApiError(error, req)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { tenantId } = await params

    const body = await req.json()
    const { planSlug, status, notes, currentPeriodEnd } = body as {
      planSlug?: string
      status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
      notes?: string
      /** ISO instant. Required when the change grants access on a lapsed
       *  trial / gift / admin row (see grantNeedsNewEnd). */
      currentPeriodEnd?: string
    }

    if (!planSlug && !status) {
      return NextResponse.json({ error: 'planSlug or status required' }, { status: 400 })
    }

    const existing = await getSubscription(tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const now = new Date()
    let newEnd: Date | null = null
    if (currentPeriodEnd !== undefined) {
      newEnd = new Date(currentPeriodEnd)
      if (Number.isNaN(newEnd.getTime()) || newEnd.getTime() <= now.getTime()) {
        return NextResponse.json({ error: 'A nova data de fim precisa estar no futuro.' }, { status: 400 })
      }
    }
    // A Stripe row stays a Stripe row on an admin plan change: turning it into
    // `admin` would cut it off from the webhook and lock a payer at the end of
    // the billing period.
    const source = existing.source === 'stripe' ? 'stripe' : 'admin'
    const nextStatus = status ?? existing.status
    if (!newEnd && grantNeedsNewEnd({ status: nextStatus, source, currentPeriodEnd: existing.currentPeriodEnd }, now)) {
      return NextResponse.json(
        {
          error: 'Este acesso já terminou. Informe uma nova data de fim no futuro para reativar ou trocar o plano.',
          code: 'period_end_required',
        },
        { status: 400 },
      )
    }

    const changes: Record<string, { old: unknown; new: unknown }> = {}
    let result = existing

    if (planSlug && planSlug !== existing.plan.slug) {
      const plan = await getPlanBySlug(planSlug)
      if (!plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }

      const updated = await updateSubscriptionPlan(tenantId, plan.id, source, {
        status: status ?? undefined,
        currentPeriodEnd: newEnd ?? undefined,
      })
      if (!updated) {
        return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      }

      changes.plan = { old: existing.plan.slug, new: planSlug }
      if (status && status !== existing.status) {
        changes.status = { old: existing.status, new: status }
      }
      result = { ...updated, plan } as typeof existing
    } else if (status && status !== existing.status) {
      const updated = await updateSubscriptionStatus(tenantId, status)
      if (!updated) {
        return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      }

      changes.status = { old: existing.status, new: status }
      result = { ...updated, plan: existing.plan } as typeof existing
    }

    if (newEnd && !(planSlug && planSlug !== existing.plan.slug)) {
      const updated = await updateSubscriptionPeriod(tenantId, {
        currentPeriodStart: result.currentPeriodStart,
        currentPeriodEnd: newEnd,
      })
      if (!updated) {
        return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      }
      result = { ...result, ...updated, plan: result.plan } as typeof existing
    }
    if (newEnd) {
      changes.currentPeriodEnd = { old: existing.currentPeriodEnd, new: newEnd }
    }

    if (notes) {
      changes.notes = { old: null, new: notes }
    }

    if (Object.keys(changes).length > 0) {
      await createAuditLog({
        tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'subscription',
        entityId: existing.id,
        changes,
      })
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    return handleApiError(error, req)
  }
}

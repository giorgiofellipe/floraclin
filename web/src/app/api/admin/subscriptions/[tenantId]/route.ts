import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import {
  getSubscription,
  getPlanBySlug,
  getUserFullName,
  updateSubscriptionPeriod,
  updateSubscriptionPlan,
  updateSubscriptionStatus,
} from '@/db/queries/subscriptions'
import { grantNeedsNewEnd } from '@/lib/subscription-access'
import { stripeAdminBlock } from '@/lib/admin-stripe-guard'
import type { StripeSubscriptionState } from '@/lib/stripe'
import { STRIPE_UNAVAILABLE_MESSAGE, stripeStateFor } from '@/lib/admin-stripe-state'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'
import type { AdminFeedbackDiscount } from '@/lib/feedback-eligibility'

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

    const grantedBy = subscription.feedbackDiscountGrantedBy
    const [creditUsage, state, grantedByName] = await Promise.all([
      getCreditUsage(tenantId),
      stripeStateFor(subscription),
      grantedBy ? getUserFullName(grantedBy) : Promise.resolve(null),
    ])
    const stripeState = state === 'unavailable' ? null : state
    const feedbackDiscount: AdminFeedbackDiscount | null = subscription.feedbackDiscountGrantedAt
      ? { grantedAt: subscription.feedbackDiscountGrantedAt.toISOString(), grantedBy, grantedByName }
      : null

    return NextResponse.json({ data: { ...subscription, creditUsage, stripeState, feedbackDiscount } })
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
    const planChanged = !!planSlug && planSlug !== existing.plan.slug
    const nextStatus = status ?? existing.status
    const grants = nextStatus === 'active' || nextStatus === 'trialing'

    let stripeState: StripeSubscriptionState | null = null
    // Only a reactivation of a lapsed Stripe row needs Stripe's word.
    if (grants && !planChanged && (existing.status === 'canceled' || existing.status === 'expired')) {
      const state = await stripeStateFor(existing)
      if (state === 'unavailable') {
        return NextResponse.json(
          { error: STRIPE_UNAVAILABLE_MESSAGE, code: 'stripe_unavailable' },
          { status: 503 },
        )
      }
      stripeState = state
    }
    const blocked = stripeAdminBlock(existing, { planChanged, nextStatus, newEnd: !!newEnd }, now, {
      stripeState,
    })
    if (blocked) {
      return NextResponse.json({ error: blocked.message, code: blocked.code }, { status: 400 })
    }

    // Reactivating a cancelled / expired Stripe row has no Stripe
    // subscription behind it any more: it becomes an admin grant with its own
    // future end date, like any other grant. Otherwise a Stripe row stays a
    // Stripe row.
    const reactivatingStripe =
      existing.source === 'stripe' && (existing.status === 'canceled' || existing.status === 'expired') && grants
    const source = existing.source === 'stripe' && !reactivatingStripe ? 'stripe' : 'admin'
    if (
      !newEnd &&
      (reactivatingStripe || grantNeedsNewEnd({ status: nextStatus, source, currentPeriodEnd: existing.currentPeriodEnd }, now))
    ) {
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

    if (planChanged || reactivatingStripe) {
      const plan = planChanged ? await getPlanBySlug(planSlug!) : existing.plan
      if (!plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }

      // One write for plan, source, status and end.
      const updated = await updateSubscriptionPlan(tenantId, plan.id, source, {
        status: status ?? undefined,
        currentPeriodEnd: newEnd ?? undefined,
      })
      if (!updated) {
        return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      }

      if (planChanged) changes.plan = { old: existing.plan.slug, new: planSlug }
      if (source !== existing.source) changes.source = { old: existing.source, new: source }
      if (status && status !== existing.status) {
        changes.status = { old: existing.status, new: status }
      }
      result = { ...updated, plan } as typeof existing
    } else {
      if (status && status !== existing.status) {
        const updated = await updateSubscriptionStatus(tenantId, status)
        if (!updated) {
          return NextResponse.json({ error: 'Update failed' }, { status: 500 })
        }
        changes.status = { old: existing.status, new: status }
        result = { ...updated, plan: existing.plan } as typeof existing
      }
      if (newEnd) {
        const updated = await updateSubscriptionPeriod(tenantId, {
          currentPeriodStart: result.currentPeriodStart,
          currentPeriodEnd: newEnd,
        })
        if (!updated) {
          return NextResponse.json({ error: 'Update failed' }, { status: 500 })
        }
        result = { ...result, ...updated, plan: result.plan } as typeof existing
      }
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

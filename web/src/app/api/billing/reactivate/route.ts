import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { resumeStripeSubscription } from '@/lib/stripe'
import { handleApiError } from '@/lib/api-error'

/**
 * Undoes a cancellation that has not taken effect yet.
 *
 * Only valid while the paid period is still open: cancelling sets
 * `cancel_at_period_end`, so until then Stripe still has a live subscription
 * and clearing the flag is the whole operation. Once the period closes there
 * is nothing to resume and the way back is a new checkout.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscription = await getSubscription(ctx.tenantId)
    if (!subscription) {
      return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
    }

    if (subscription.status !== 'canceled') {
      return NextResponse.json({ error: 'Esta assinatura não está cancelada' }, { status: 400 })
    }

    if (!subscription.stripeSubscriptionId) {
      return NextResponse.json({ error: 'Nenhuma assinatura Stripe vinculada' }, { status: 400 })
    }

    if (!subscription.currentPeriodEnd || subscription.currentPeriodEnd <= new Date()) {
      return NextResponse.json(
        { error: 'O período contratado já terminou. Assine um plano para continuar.' },
        { status: 400 },
      )
    }

    // Stripe first. Writing 'active' locally on a resume that did not happen
    // would tell the tenant they are subscribed while Stripe still ends the
    // subscription at period end.
    await resumeStripeSubscription(subscription.stripeSubscriptionId)
    await updateSubscriptionStatus(ctx.tenantId, 'active', { canceledAt: null })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

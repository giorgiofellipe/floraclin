import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { cancelStripeSubscription } from '@/lib/stripe'
import { handleApiError } from '@/lib/api-error'

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

    if (!subscription.stripeSubscriptionId) {
      return NextResponse.json({ error: 'Nenhuma assinatura Stripe vinculada' }, { status: 400 })
    }

    await cancelStripeSubscription(subscription.stripeSubscriptionId)
    await updateSubscriptionStatus(ctx.tenantId, 'canceled', { canceledAt: new Date() })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

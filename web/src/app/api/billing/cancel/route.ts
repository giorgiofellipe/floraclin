import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { cancelStripeSubscription } from '@/lib/stripe'

export async function POST() {
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Billing cancel error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPlanBySlug, updateSubscriptionPlan } from '@/db/queries/subscriptions'
import { retrieveCheckoutSession } from '@/lib/stripe'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const sessionId = body.sessionId as string | undefined

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId é obrigatório' }, { status: 400 })
    }

    const session = await retrieveCheckoutSession(sessionId)

    // The session id travels in a URL the customer controls (success_url),
    // so without this check pasting another clinic's session id would
    // activate your account on their payment.
    if (session.metadata?.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ activated: false })
    }

    // A Checkout Session stays 'paid' forever, so replaying an old one after
    // a cancellation would otherwise resurrect a dead subscription. Check
    // the expanded subscription's CURRENT status instead of the session
    // snapshot. `session.subscription` may come back as a string (not
    // expanded) or an object; a string means we cannot check its status, so
    // treat that as not activatable.
    const subscription =
      typeof session.subscription === 'string' ? null : session.subscription

    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
      return NextResponse.json({ activated: false })
    }

    const planSlug = session.metadata?.planSlug
    const plan = planSlug ? await getPlanBySlug(planSlug) : null
    if (!plan || !plan.active) {
      return NextResponse.json({ activated: false })
    }

    const stripeSubscriptionId =
      typeof subscription.id === 'string' ? subscription.id : String(subscription.id)
    const stripeCustomerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

    await updateSubscriptionPlan(ctx.tenantId, plan.id, 'stripe', {
      status: 'active',
      stripeSubscriptionId,
      stripeCustomerId,
    })

    return NextResponse.json({ activated: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

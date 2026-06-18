import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription, getPlanBySlug } from '@/db/queries/subscriptions'
import { createCheckoutSession } from '@/lib/stripe'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const planSlug = body.planSlug as string | undefined

    if (!planSlug) {
      return NextResponse.json({ error: 'planSlug é obrigatório' }, { status: 400 })
    }

    const plan = await getPlanBySlug(planSlug)
    if (!plan || !plan.active) {
      return NextResponse.json({ error: 'Plano não encontrado' }, { status: 404 })
    }

    const subscription = await getSubscription(ctx.tenantId)
    const stripeCustomerId = subscription?.stripeCustomerId ?? null

    const { url } = await createCheckoutSession(ctx.tenantId, planSlug, stripeCustomerId)

    return NextResponse.json({ url })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Billing checkout error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

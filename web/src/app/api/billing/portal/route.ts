import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { createBillingPortalSession } from '@/lib/stripe'
import { getAppUrl } from '@/lib/app-url'
import { handleApiError } from '@/lib/api-error'

/**
 * Sends the owner to Stripe's billing management page.
 *
 * The app cannot update a card, and `past_due` is the state where that is the
 * only thing that helps, so this is the recovery path for it. Stripe hosts
 * the card form, the invoice history and its own cancellation flow.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscription = await getSubscription(ctx.tenantId)
    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'Nenhum cadastro de pagamento encontrado' },
        { status: 400 },
      )
    }

    // The read-only paywall of a `past_due` subscription asks for the
    // payment-method flow; everything else gets the portal home.
    const body = (await request.json().catch(() => null)) as { flow?: unknown } | null
    const flow = body?.flow === 'payment_method_update' ? 'payment_method_update' : undefined

    const { url } = await createBillingPortalSession(
      subscription.stripeCustomerId,
      `${getAppUrl()}/configuracoes?tab=assinatura`,
      flow ? { flow } : undefined,
    )

    return NextResponse.json({ url })
  } catch (error) {
    return handleApiError(error, request)
  }
}

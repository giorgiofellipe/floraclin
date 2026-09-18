import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { suspendTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendRejectionEmail } from '@/lib/email'
import { getSubscription, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { cancelStripeSubscription } from '@/lib/stripe'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params

    const ownerEmail = await getTenantOwnerEmail(id)
    const tenant = await suspendTenant(id)
    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    // Access is gone the moment the tenant is soft-deleted, including the
    // billing portal, so leaving the Stripe subscription running would keep
    // charging a clinic that cannot use anything or reach a cancel button.
    // At period end rather than immediately: they paid for it.
    const subscription = await getSubscription(id)
    if (subscription?.stripeSubscriptionId && subscription.status !== 'canceled') {
      try {
        await cancelStripeSubscription(subscription.stripeSubscriptionId)
        await updateSubscriptionStatus(id, 'canceled', { canceledAt: new Date() })
      } catch (err) {
        // The suspension itself stands. Cutting off abuse must not wait on
        // Stripe being reachable, but a subscription still billing is not
        // something to discover from a chargeback.
        reportSideEffectFailure(err, { area: 'admin', step: 'suspension_cancel_stripe' })
      }
    }

    if (ownerEmail) {
      void sendRejectionEmail(ownerEmail, tenant.name).catch(err =>
        reportSideEffectFailure(err, { area: 'admin', step: 'suspension_email' }),
      )
    }

    return NextResponse.json({ data: tenant })
  } catch (error) {
    return handleApiError(error, req)
  }
}

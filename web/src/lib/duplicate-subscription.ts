import { getSubscription } from '@/db/queries/subscriptions'
import { cancelStripeSubscriptionNow, getStripeSubscriptionState } from '@/lib/stripe'
import { reportSideEffectFailure } from '@/lib/observability'

/**
 * A completed checkout for a tenant whose row already points at another subscription Stripe is still billing
 * (two open checkouts both paid). The row keeps the existing one and the new one is cancelled, so neither bills
 * unseen. True when that happened and the caller must not store the new subscription.
 */
export async function cancelDuplicateSubscription(tenantId: string, newSubscriptionId: string): Promise<boolean> {
  const existing = (await getSubscription(tenantId))?.stripeSubscriptionId
  if (!existing || existing === newSubscriptionId) return false
  if ((await getStripeSubscriptionState(existing)) !== 'live') return false

  await cancelStripeSubscriptionNow(newSubscriptionId)
  reportSideEffectFailure(new Error('Checkout completed while another subscription is live; cancelled the new one'), {
    area: 'billing',
    step: 'duplicate_subscription',
    extra: { tenantId, kept: existing, cancelled: newSubscriptionId },
  })
  return true
}

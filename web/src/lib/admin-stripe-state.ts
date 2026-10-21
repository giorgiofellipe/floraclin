import { getStripeSubscriptionState, type StripeSubscriptionState } from '@/lib/stripe'
import { reportSideEffectFailure } from '@/lib/observability'

/**
 * Server side of lib/admin-stripe-guard: what Stripe says about a
 * Stripe-sourced row's subscription (see getStripeSubscriptionState),
 * whatever our row says. Null when there is nothing to ask (not a Stripe row,
 * or no subscription id); 'unavailable' when Stripe could not be reached.
 */
export async function stripeStateFor(row: {
  source?: string | null
  stripeSubscriptionId?: string | null
}): Promise<StripeSubscriptionState | 'unavailable' | null> {
  if (row.source !== 'stripe' || !row.stripeSubscriptionId) return null
  try {
    return await getStripeSubscriptionState(row.stripeSubscriptionId)
  } catch (err) {
    reportSideEffectFailure(err, {
      area: 'billing',
      step: 'admin_stripe_state',
      extra: { subscriptionId: row.stripeSubscriptionId },
    })
    return 'unavailable'
  }
}

export const STRIPE_UNAVAILABLE_MESSAGE = 'Não foi possível consultar o Stripe agora. Tente novamente em instantes.'

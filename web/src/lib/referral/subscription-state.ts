import type Stripe from 'stripe'
import { isReferralEligiblePlan } from './rules'

type SubLike = Pick<Stripe.Subscription, 'status'> & {
  items: { data: Array<{ price: { recurring: { interval: string; interval_count: number } | null } }> }
}

/** items.data[0].price.recurring is month × 1. */
export function stripeSubscriptionIsMonthly(sub: SubLike): boolean {
  const recurring = sub.items.data[0]?.price.recurring
  if (!recurring || recurring.interval_count !== 1) return false
  return isReferralEligiblePlan({ billingInterval: recurring.interval })
}

const NOT_UPDATABLE = new Set<string>(['canceled', 'incomplete_expired', 'incomplete'])
const HEALTHY = new Set<string>(['active', 'trialing', 'past_due'])

/**
 * Decides from the Stripe subscription, never from the local period end (which lags renewals).
 * updatable: the sub is still open in Stripe. eligible: updatable, paid through Stripe locally,
 * healthy and monthly. cancel_at_period_end changes neither flag.
 */
export function referrerSubscriptionState(
  sub: SubLike | 'missing' | null,
  localSource: string | null | undefined,
): { updatable: boolean; eligible: boolean } {
  if (sub === null || sub === 'missing') return { updatable: false, eligible: false }
  const updatable = !NOT_UPDATABLE.has(sub.status)
  const eligible =
    updatable && localSource === 'stripe' && HEALTHY.has(sub.status) && stripeSubscriptionIsMonthly(sub)
  return { updatable, eligible }
}

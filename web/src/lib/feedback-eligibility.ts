import { effectiveSubscriptionStatus, type SubscriptionAccessRow } from '@/lib/subscription-access'

// Pure (no DB, no Stripe): shared by checkout, the admin route and the admin screen.

export interface FeedbackEligibilityRow extends SubscriptionAccessRow {
  firstPaidAt?: Date | string | null
}

export type FeedbackIneligibility = 'stripe' | 'not_trial'

/**
 * Why a row cannot hold the feedback reward, or null when it can: a trial
 * clinic (running or ended) that never subscribed. A clinic Stripe bills or
 * has billed, or one on a gift / admin grant, is out.
 */
export function feedbackIneligibility(
  row: FeedbackEligibilityRow | null | undefined,
  now: Date = new Date(),
): FeedbackIneligibility | null {
  if (!row) return 'not_trial'
  if (row.source === 'stripe' || row.stripeSubscriptionId || row.firstPaidAt) return 'stripe'
  if (row.source !== 'trial') return 'not_trial'
  const status = effectiveSubscriptionStatus(row, now)
  return status === 'trialing' || status === 'expired' ? null : 'not_trial'
}

export const FEEDBACK_INELIGIBLE_MESSAGES: Record<FeedbackIneligibility, string> = {
  stripe:
    'Esta clínica já tem ou já teve uma assinatura paga no Stripe. O desconto de feedback vale só para clínicas em teste ou com o teste encerrado.',
  not_trial: 'O desconto de feedback vale só para clínicas em teste ou com o teste encerrado.',
}

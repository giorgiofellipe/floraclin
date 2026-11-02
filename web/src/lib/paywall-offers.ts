import type { SubscriptionWithPlan, Plan } from '@/db/queries/subscriptions'
import { getValidatedFeedbackOffer, publicFeedbackOffer, type ValidatedFeedbackOffer } from '@/lib/feedback-offer'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { publicWinbackOffer, type ValidatedWinbackOffer } from '@/lib/winback'
import { getValidatedReferralOffer, publicReferralOffer, type ValidatedReferralOffer } from '@/lib/referral/offer'
import type { EntryOffer } from '@/components/layout/plan-checkout'

/** A lookup, or null where that offer does not apply. */
type OfferLookup<T> = (() => Promise<T | null>) | null

/**
 * The one offer a clinic gets, in this order: feedback, win-back (VOLTA30),
 * referral. A lower offer is not looked up once a higher one validates, so a
 * flagged clinic costs no win-back or referral Stripe calls.
 */
export async function pickOffers<F, W, R>(lookups: {
  feedback: OfferLookup<F>
  winback: OfferLookup<W>
  referral: OfferLookup<R>
}): Promise<F | W | R | null> {
  const feedback = lookups.feedback ? await lookups.feedback() : null
  if (feedback) return feedback
  const winback = lookups.winback ? await lookups.winback() : null
  if (winback) return winback
  return lookups.referral ? await lookups.referral() : null
}

/** The client-safe part of whichever offer was picked: the promotion code id stays server-side. */
function publicEntryOffer(
  offer: ValidatedFeedbackOffer | ValidatedWinbackOffer | ValidatedReferralOffer | null,
): EntryOffer | null {
  if (offer?.kind === 'feedback') return publicFeedbackOffer(offer)
  if (offer?.kind === 'winback') return publicWinbackOffer(offer)
  if (offer?.kind === 'referral') return publicReferralOffer(offer)
  return null
}

/**
 * The offer the paywall (a lapsed clinic) and the trial-ending modal show.
 * Win-back is only for a lapsed clinic; none at all while the way back is
 * fixing the card. Per plan: a coupon restricted to some products discounts
 * only those.
 */
export async function paywallOffer(
  subscription: SubscriptionWithPlan | null,
  plans: Plan[],
  now: Date,
  view: { readOnly: boolean; trialEnding: boolean; recovery: 'checkout' | 'payment_update' },
): Promise<EntryOffer | null> {
  if (view.recovery !== 'checkout' || !(view.readOnly || view.trialEnding)) return null
  const offer = await pickOffers({
    feedback: () => getValidatedFeedbackOffer(subscription, plans, now),
    winback: view.readOnly ? () => getValidatedWinbackOffer(subscription, plans, now) : null,
    referral: () => getValidatedReferralOffer(subscription, plans, now).catch(() => null),
  })
  return publicEntryOffer(offer)
}

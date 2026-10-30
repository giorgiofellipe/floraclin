// Pure (no DB, no Stripe): which offer the paywall and the trial-ending modal
// show. Exactly one, in checkout's order: feedback, win-back (VOLTA30),
// referral. A lower offer is not even looked up once a higher one validates,
// so a flagged clinic costs no win-back or referral Stripe calls.

/** A lookup, or null where that offer does not apply. */
type OfferLookup<T> = (() => Promise<T | null>) | null

export interface PickedOffers<F, W, R> {
  feedback: F | null
  winback: W | null
  referral: R | null
}

export async function pickOffers<F, W, R>(lookups: {
  feedback: OfferLookup<F>
  winback: OfferLookup<W>
  referral: OfferLookup<R>
}): Promise<PickedOffers<F, W, R>> {
  const feedback = lookups.feedback ? await lookups.feedback() : null
  if (feedback) return { feedback, winback: null, referral: null }
  const winback = lookups.winback ? await lookups.winback() : null
  if (winback) return { feedback: null, winback, referral: null }
  const referral = lookups.referral ? await lookups.referral() : null
  return { feedback: null, winback: null, referral }
}

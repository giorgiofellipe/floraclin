import type { PromotionCodeTerms } from '@/lib/stripe'

// Client-safe: imported by 'use client' modules. Type-only imports only.

/** The feedback reward offer as the paywall and the billing page read it: no promotion code id. */
export interface PublicFeedbackOffer {
  kind: 'feedback'
  label: string // "50% de desconto nos 3 primeiros meses"
  percentOff: number | null
  amountOffCents: number | null
  duration: PromotionCodeTerms['duration']
  durationInMonths: number | null
  planSlugs: string[]
}

/** "Obrigado pelo feedback: {label}." */
export function feedbackOfferHeadline(o: Pick<PublicFeedbackOffer, 'label'>): string {
  return `Obrigado pelo feedback: ${o.label}.`
}

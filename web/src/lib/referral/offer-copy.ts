import type { PromotionCodeTerms } from '@/lib/stripe'
import { shortClinicName } from './rules'

// Client-safe: imported by 'use client' modules. Only ./rules, ./types and type-only imports allowed.

export interface PublicReferralOffer {
  kind: 'referral'
  referrerName: string
  label: string // "20% de desconto nos 2 primeiros meses"
  percentOff: number | null
  amountOffCents: number | null
  duration: PromotionCodeTerms['duration']
  durationInMonths: number | null
  planSlugs: string[]
}

/** "Indicação de {shortClinicName(nome)}: {label}." */
export function referralOfferHeadline(o: Pick<PublicReferralOffer, 'referrerName' | 'label'>): string {
  return `Indicação de ${shortClinicName(o.referrerName)}: ${o.label}.`
}

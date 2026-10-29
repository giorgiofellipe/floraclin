export type { ReferralPercent } from './rules'
export type ReferralStatus = 'trial' | 'trial_ended' | 'first_paid' | 'counting' | 'paused' | 'canceled' | 'ineligible'
export type IneligibleReason = 'self_referral' | 'not_new' | 'chargeback' | 'admin'
export type PausedReason = 'past_due' | 'cancel_scheduled'
export type CapturedVia = 'link' | 'signup_field' | 'billing_page'
export type RewardEventReason =
  | 'referral_counting' | 'referral_paused' | 'referral_canceled'
  | 'reconcile' | 'invoice_draft' | 'admin' | 'subscription'
export type SignalKind = 'owner_email' | 'email_domain' | 'phone' | 'registry' | 'shared_user' | 'card'
export type NotNewSignalKind = 'owner_email' | 'phone' | 'registry' | 'card'

/** The persisted state of one referral. */
export interface ReferralState {
  status: ReferralStatus
  pausedReason: PausedReason | null
  ineligibleReason: IneligibleReason | null
  stripeSubscriptionId: string | null
  firstPaidAt: Date | null
  qualifiedAt: Date | null
  qualifyingInvoiceId: string | null
  endedAt: Date | null
}

/** One card seen on a tenant, with Stripe charge times. */
export interface CardSighting { fingerprint: string; firstSeenAt: Date; lastSeenAt: Date }

/** Identity signals of one tenant, already normalised. */
export interface TenantSignals {
  tenantId: string
  ownerEmails: string[] // lower-cased, trimmed
  phones: string[] // normalizeBrPhone() digits; tenant phone + owner users' phones
  registries: string[] // `${TYPE}:${digitsOnlyNumber}:${UF}` for every active user with all 3 set
  userIds: string[] // every tenant_users.user_id (any role)
  cardFingerprints: string[]
}
/** A tenant that might make the referred clinic "not new". */
export interface CandidateTenant extends TenantSignals {
  subscriptionCreatedAt: Date
  subscriptionEndsAt: Date // tenant_subscriptions.current_period_end, read at attribution time only
  cards: CardSighting[] // billing_card_fingerprints rows of this tenant
}
export interface CheckResult { selfReferral: SignalKind[]; notNew: Array<{ tenantId: string; signals: SignalKind[] }> }
/** Persisted in tenant_referrals.checks; never shown raw to the referrer. */
export interface ReferralChecks {
  atSignup?: CheckResult // identity snapshot
  atCheckout?: CheckResult // re-check before the welcome coupon
  atQualification?: CheckResult // self-referral (all signals) + card-only not-new
  adminNote?: string
}

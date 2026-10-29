import type Stripe from 'stripe'
import type { IneligibleReason, PausedReason, ReferralState, ReferralStatus } from './types'
export type { ReferralState } from './types'

/** Everything the machine reads, gathered fresh by refreshReferral. */
export interface ReferredSnapshot {
  now: Date
  /** tenants.deleted_at set (admin removed the clinic). */
  tenantDeleted: boolean
  /** No Stripe subscription yet and the local trial/grant row is past its end. */
  localTrialEnded: boolean
  /** The referral's subscription (first one the clinic ever opened); null when it never checked out. */
  stripe: null | {
    subscriptionId: string
    status: Stripe.Subscription.Status | 'missing' // 'missing' = Stripe says resource_missing
    cancelAtPeriodEnd: boolean
    /** Price recurring interval is month × 1 (isReferralEligiblePlan). */
    monthly: boolean
    /** Earliest paid invoice of this subscription, from a fully paginated list. */
    firstPaidAt: Date | null
    /** Earliest invoice with billing_reason 'subscription_cycle', status paid, amount_paid > 0. */
    qualifyingInvoice: { id: string; paidAt: Date } | null
  }
  /** Decided by the caller: failed checks, chargeback, admin mark. */
  ineligible: IneligibleReason | null
}

export function isTerminalStatus(s: ReferralStatus): boolean {
  return s === 'canceled' || s === 'ineligible'
}

const DEAD_STRIPE_STATUSES = new Set<string>(['canceled', 'incomplete_expired', 'missing'])
const OVERDUE_STRIPE_STATUSES = new Set<string>(['past_due', 'unpaid', 'paused'])

/** Pure: returns a new state, never mutates `prev`; unchanged input yields a deep-equal result. */
export function computeReferralStatus(prev: ReferralState, snap: ReferredSnapshot): ReferralState {
  const { now, stripe } = snap

  if (prev.status === 'ineligible') return { ...prev }
  if (snap.ineligible) {
    return {
      ...prev,
      status: 'ineligible',
      ineligibleReason: snap.ineligible,
      pausedReason: null,
      endedAt: prev.endedAt ?? now,
    }
  }
  if (prev.status === 'canceled') return { ...prev }
  if (snap.tenantDeleted) return { ...prev, status: 'canceled', pausedReason: null, endedAt: now }
  if (stripe === null) {
    if (prev.status !== 'trial' && prev.status !== 'trial_ended') return { ...prev }
    return { ...prev, status: snap.localTrialEnded ? 'trial_ended' : 'trial' }
  }
  if (DEAD_STRIPE_STATUSES.has(stripe.status)) {
    return { ...prev, status: 'canceled', pausedReason: null, endedAt: now }
  }
  if (
    stripe.status === 'incomplete' ||
    (prev.firstPaidAt == null && prev.qualifiedAt == null && stripe.firstPaidAt == null)
  ) {
    return { ...prev, stripeSubscriptionId: stripe.subscriptionId }
  }

  const next: ReferralState = {
    ...prev,
    stripeSubscriptionId: stripe.subscriptionId,
    firstPaidAt: prev.firstPaidAt ?? stripe.firstPaidAt,
  }
  const qualified = prev.qualifiedAt != null || (stripe.qualifyingInvoice != null && stripe.monthly)
  if (prev.qualifiedAt == null && qualified && stripe.qualifyingInvoice) {
    next.qualifiedAt = stripe.qualifyingInvoice.paidAt
    next.qualifyingInvoiceId = stripe.qualifyingInvoice.id
  }

  if (!qualified || !stripe.monthly) return { ...next, status: 'first_paid', pausedReason: null }
  if (OVERDUE_STRIPE_STATUSES.has(stripe.status)) return { ...next, status: 'paused', pausedReason: 'past_due' }
  if (stripe.cancelAtPeriodEnd) return { ...next, status: 'paused', pausedReason: 'cancel_scheduled' }
  if (stripe.status === 'active' || stripe.status === 'trialing') {
    return { ...next, status: 'counting', pausedReason: null }
  }
  // Unknown Stripe status: keep what we had.
  return next
}

const INELIGIBLE_SUBLABELS: Record<IneligibleReason, string> = {
  self_referral: 'mesma clínica ou profissional',
  not_new: 'clínica já usou o FloraClin',
  chargeback: 'contestação de pagamento',
  admin: 'não atende às regras do programa',
}

const PAUSED_SUBLABELS: Record<PausedReason, string> = {
  past_due: 'pagamento pendente',
  cancel_scheduled: 'cancelamento agendado',
}

/** Dashboard label + optional sublabel (exact pt-BR). */
export function referralStatusLabel(r: {
  status: ReferralStatus
  pausedReason: PausedReason | null
  ineligibleReason: IneligibleReason | null
}): { label: string; sublabel: string | null } {
  switch (r.status) {
    case 'trial':
      return { label: 'em teste', sublabel: null }
    case 'trial_ended':
      return { label: 'teste encerrado', sublabel: null }
    case 'first_paid':
      return { label: 'pagante', sublabel: 'conta a partir da 2ª mensalidade' }
    case 'counting':
      return { label: 'pagante', sublabel: null }
    case 'paused':
      return { label: 'pagante', sublabel: r.pausedReason ? PAUSED_SUBLABELS[r.pausedReason] : null }
    case 'canceled':
      return { label: 'cancelada', sublabel: null }
    case 'ineligible':
      return {
        label: 'não elegível',
        sublabel: r.ineligibleReason ? INELIGIBLE_SUBLABELS[r.ineligibleReason] : null,
      }
  }
}

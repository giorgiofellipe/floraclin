import { formatBrDate } from '@/lib/dates'

/**
 * What a platform admin may not do by hand to a subscription billed through
 * Stripe, and the pt-BR reason. Shared by the admin API (which enforces it)
 * and the admin dialog (which explains it before the admin tries).
 *
 * - Plan change: the plan of a Stripe subscription is its Stripe price, so a
 *   local change would bill one plan and grant another.
 * - Cancel / expire: only Stripe stops the charges; a local write would cut
 *   off a clinic that keeps paying.
 * - Reactivate while a cancellation at the period end is still pending at
 *   Stripe: the clinic keeps its paid access until then and can undo it in
 *   the billing portal. Turning it into an admin grant now would detach the
 *   row from a subscription Stripe may still resume. Our row cannot tell that
 *   apart from a subscription Stripe already ended, or one resumed before our
 *   webhook caught up (all read `canceled`), so the caller asks Stripe
 *   (`stripeState`) and only an ended subscription can become a grant.
 * - Move the end date: Stripe owns the billing period. Only reactivating a
 *   Stripe row that is over sets one, and that turns it into an admin grant.
 */
export type StripeAdminBlockCode =
  | 'stripe_plan_change'
  | 'stripe_cancel'
  | 'stripe_period_open'
  | 'stripe_period_change'
  | 'stripe_still_active'

export interface StripeAdminBlock {
  code: StripeAdminBlockCode
  message: string
}

interface Row {
  source?: string | null
  status: string
  currentPeriodEnd: Date | string | null
}

const PORTAL = 'pelo portal de cobrança (Configurações › Assinatura)'

export function stripePlanChangeMessage(): string {
  return `Esta clínica assina pelo Stripe. Altere o plano no painel do Stripe ou ${PORTAL}.`
}

export function stripeCancelMessage(): string {
  return `Esta clínica assina pelo Stripe. Cancele a assinatura no painel do Stripe ou ${PORTAL}.`
}

export function stripePeriodChangeMessage(): string {
  return `Esta clínica assina pelo Stripe, que define o período pago. Altere a assinatura no painel do Stripe ou ${PORTAL}.`
}

export function stripeStillActiveMessage(): string {
  return `A assinatura desta clínica ainda está ativa no Stripe. Confira no painel do Stripe ou ${PORTAL}; não é preciso reativar aqui.`
}

export function stripePeriodOpenMessage(periodEnd: Date | string): string {
  return `Esta clínica ainda tem acesso pago até ${formatBrDate(periodEnd)}. Ela pode retomar a assinatura ${PORTAL}.`
}

/** A cancelled Stripe row whose paid period has not ended yet. */
export function stripePeriodStillOpen(row: Row, now: Date = new Date()): boolean {
  return (
    row.source === 'stripe' &&
    (row.status === 'canceled' || row.status === 'expired') &&
    !!row.currentPeriodEnd &&
    new Date(row.currentPeriodEnd).getTime() > now.getTime()
  )
}

export function stripeAdminBlock(
  row: Row,
  change: { planChanged: boolean; nextStatus: string; newEnd?: boolean },
  now: Date = new Date(),
  /** What Stripe says about the row's subscription; asked for a reactivation. */
  opts: { stripeState?: 'pending_cancel' | 'live' | 'ended' | null } = {},
): StripeAdminBlock | null {
  if (row.source !== 'stripe') return null
  if (change.planChanged) return { code: 'stripe_plan_change', message: stripePlanChangeMessage() }
  const statusChanged = change.nextStatus !== row.status
  if (statusChanged && (change.nextStatus === 'canceled' || change.nextStatus === 'expired')) {
    return { code: 'stripe_cancel', message: stripeCancelMessage() }
  }
  const grants = change.nextStatus === 'active' || change.nextStatus === 'trialing'
  const reactivating = grants && (row.status === 'canceled' || row.status === 'expired')
  if (reactivating && opts.stripeState === 'pending_cancel') {
    return stripePeriodStillOpen(row, now)
      ? { code: 'stripe_period_open', message: stripePeriodOpenMessage(row.currentPeriodEnd!) }
      : { code: 'stripe_still_active', message: stripeStillActiveMessage() }
  }
  if (reactivating && opts.stripeState === 'live') {
    return { code: 'stripe_still_active', message: stripeStillActiveMessage() }
  }
  if (change.newEnd && !reactivating) {
    return { code: 'stripe_period_change', message: stripePeriodChangeMessage() }
  }
  return null
}

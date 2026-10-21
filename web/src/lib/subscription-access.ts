/**
 * Pure access rules for a tenant subscription row. No DB, no Next imports, so
 * the server gate (`isSubscriptionActive`), the platform layout (read-only
 * mode, paywall, banner) and the expiry cron all agree on one definition.
 *
 * - Stripe-driven rows (`source = 'stripe'` or a Stripe subscription id) keep
 *   their status as Stripe reports it: `active` is active, and the webhook is
 *   what moves them. Their `current_period_end` is the billing period, which
 *   Stripe renews; trusting it here would lock a payer for the few hours
 *   between period end and the renewal webhook.
 * - Everything else (`trial`, `gift`, `admin`) ends exactly at
 *   `current_period_end`, whatever the stored status says, so access never
 *   depends on the 00:00 BRT expiry cron having run yet.
 * - `canceled` and `past_due` honour the already-paid period.
 */
export interface SubscriptionAccessRow {
  status: string
  source?: string | null
  stripeSubscriptionId?: string | null
  currentPeriodEnd: Date | string | null
}

export function isStripeDriven(row: Pick<SubscriptionAccessRow, 'source' | 'stripeSubscriptionId'>): boolean {
  return row.source === 'stripe' || !!row.stripeSubscriptionId
}

function periodOpen(row: SubscriptionAccessRow, now: Date): boolean {
  if (!row.currentPeriodEnd) return false
  return new Date(row.currentPeriodEnd).getTime() > now.getTime()
}

export function isSubscriptionRowActive(row: SubscriptionAccessRow | null | undefined, now: Date = new Date()): boolean {
  // Fail closed: a missing row means the tenant is blocked.
  if (!row) return false
  switch (row.status) {
    case 'trialing':
      return periodOpen(row, now)
    case 'active':
      return isStripeDriven(row) ? true : periodOpen(row, now)
    case 'canceled':
    case 'past_due':
      return periodOpen(row, now)
    default:
      return false
  }
}

/**
 * The status the UI should act on. A `trialing` or non-Stripe `active` row
 * past its end is `expired` for display, even before the cron rewrites it.
 */
export function effectiveSubscriptionStatus(
  row: SubscriptionAccessRow | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!row) return null
  if ((row.status === 'trialing' || row.status === 'active') && !isSubscriptionRowActive(row, now)) {
    return 'expired'
  }
  return row.status
}

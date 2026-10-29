import type Stripe from 'stripe'
import {
  bindReferralSubscription,
  findReferralByStripeSubscription,
  getReferralByReferredTenant,
  getTenantIdByStripeCustomer,
  getTenantIdByStripeSubscription,
  isReferrer,
  listReconcileUnits,
  markReferralsReconciled,
} from '@/db/queries/referrals'
import { reportSideEffectFailure } from '@/lib/observability'
import { findEarliestSubscriptionId, retrieveDisputeTarget } from '@/lib/stripe'
import { referrerCouponIds } from './config'
import { markReferralChargeback, recordTenantCardFingerprints, refreshReferral } from './lifecycle'
import { syncReferrerReward } from './reward'

export interface ReferralEventDeps {
  env: Record<string, string | undefined>
  refresh: typeof refreshReferral
  chargeback: typeof markReferralChargeback
  fingerprints: typeof recordTenantCardFingerprints
  sync: typeof syncReferrerReward
  findByStripeSub: typeof findReferralByStripeSubscription
  findByReferred: typeof getReferralByReferredTenant
  bindSubscription: typeof bindReferralSubscription
  tenantBySub: typeof getTenantIdByStripeSubscription
  tenantByCustomer: typeof getTenantIdByStripeCustomer
  isReferrer: typeof isReferrer
  disputeTarget: typeof retrieveDisputeTarget
  findEarliestSubscription: typeof findEarliestSubscriptionId
  listUnits: typeof listReconcileUnits
  markReconciled: typeof markReferralsReconciled
  report: typeof reportSideEffectFailure
}

const defaultDeps: ReferralEventDeps = {
  env: process.env,
  refresh: refreshReferral,
  chargeback: markReferralChargeback,
  fingerprints: recordTenantCardFingerprints,
  sync: syncReferrerReward,
  findByStripeSub: findReferralByStripeSubscription,
  findByReferred: getReferralByReferredTenant,
  bindSubscription: bindReferralSubscription,
  tenantBySub: getTenantIdByStripeSubscription,
  tenantByCustomer: getTenantIdByStripeCustomer,
  isReferrer,
  disputeTarget: retrieveDisputeTarget,
  findEarliestSubscription: findEarliestSubscriptionId,
  listUnits: listReconcileUnits,
  markReconciled: markReferralsReconciled,
  report: reportSideEffectFailure,
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.id
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  return idOf(invoice.parent?.subscription_details?.subscription)
}

/** Refresh one referral, then sync its referrer with the reason the status change implies. */
async function refreshAndSync(referralId: string, d: ReferralEventDeps): Promise<void> {
  const r = await d.refresh(referralId)
  if (!r) return
  await d.sync(r.referrerTenantId, { reason: r.rewardReason ?? 'reconcile', referralId })
}

/** The referral side, then the tenant's own referrer side, for a tenant whose subscription changed. */
async function syncTenantAndReferral(
  referral: { id: string } | null,
  tenantId: string | null,
  d: ReferralEventDeps,
): Promise<void> {
  if (referral) await refreshAndSync(referral.id, d)
  if (tenantId && (await d.isReferrer(tenantId))) await d.sync(tenantId, { reason: 'subscription' })
}

/** Common subscription path: everything is re-read from current state, only ids come from the event. */
async function handleSubscriptionChange(subId: string, d: ReferralEventDeps): Promise<void> {
  const tenantId = await d.tenantBySub(subId)
  const referral = (await d.findByStripeSub(subId)) ?? (tenantId ? await d.findByReferred(tenantId) : null)
  await syncTenantAndReferral(referral, tenantId, d)
}

export async function handleReferralStripeEvent(
  event: Stripe.Event,
  deps: Partial<ReferralEventDeps> = {},
): Promise<void> {
  const d: ReferralEventDeps = { ...defaultDeps, ...deps }
  if (referrerCouponIds(d.env) === null) return

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const tenantId = session.metadata?.tenantId
      if (!tenantId) return
      const referral = await d.findByReferred(tenantId)
      const customerId = idOf(session.customer)
      if (referral && session.mode === 'subscription' && customerId) {
        // The customer's earliest subscription, as refreshReferral binds; never just this session's,
        // which may be a replacement whose webhook beat the first one's.
        const earliest = await d.findEarliestSubscription(customerId)
        if (earliest) await d.bindSubscription(referral.id, earliest)
      }
      await syncTenantAndReferral(referral, tenantId, d)
      return
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubscriptionId(invoice)
      if (!subId) return
      const customerId = idOf(invoice.customer)
      if (customerId) {
        const tenantId = await d.tenantBySub(subId)
        if (tenantId) await d.fingerprints(tenantId, customerId)
      }
      await handleSubscriptionChange(subId, d)
      return
    }
    case 'invoice.payment_failed': {
      const subId = invoiceSubscriptionId(event.data.object as Stripe.Invoice)
      if (subId) await handleSubscriptionChange(subId, d)
      return
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await handleSubscriptionChange((event.data.object as Stripe.Subscription).id, d)
      return
    }
    case 'invoice.created': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.status !== 'draft' || invoice.billing_reason !== 'subscription_cycle') return
      const subId = invoiceSubscriptionId(invoice)
      if (!subId) return
      const tenantId = await d.tenantBySub(subId)
      if (tenantId && (await d.isReferrer(tenantId))) {
        await d.sync(tenantId, { reason: 'invoice_draft', draftInvoiceId: invoice.id })
      }
      return
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute
      const { customerId, subscriptionId } = await d.disputeTarget(dispute)
      if (!customerId) return
      const tenantId = await d.tenantByCustomer(customerId)
      if (!tenantId) return
      const referral = await d.findByReferred(tenantId)
      if (!referral) return
      // Only a dispute on an invoice of the referred subscription disqualifies.
      if (!subscriptionId) {
        d.report(new Error('dispute subscription unresolved'), {
          area: 'referral',
          step: 'dispute_unresolved',
          extra: { disputeId: dispute.id, referralId: referral.id },
        })
        return
      }
      const boundId = referral.stripeSubscriptionId ?? (await d.findEarliestSubscription(customerId))
      if (subscriptionId !== boundId) return
      const r = await d.chargeback(tenantId)
      if (r) await d.sync(r.referrerTenantId, { reason: 'referral_canceled', referralId: r.referralId })
      return
    }
    default:
      return
  }
}

export interface ReconcileResult {
  refreshed: number
  synced: number
  failed: number
  skipped: number
}

/** Per-referrer units, least recently reconciled first, deadline checked before each unit. */
export async function reconcileReferrals(
  opts: { now?: Date; deadlineAt?: number } = {},
  deps: Partial<ReferralEventDeps> = {},
): Promise<ReconcileResult> {
  const d: ReferralEventDeps = { ...defaultDeps, ...deps }
  const result: ReconcileResult = { refreshed: 0, synced: 0, failed: 0, skipped: 0 }
  if (referrerCouponIds(d.env) === null) return result

  const units = await d.listUnits()
  for (let i = 0; i < units.length; i++) {
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
      result.skipped = units.length - i
      break
    }
    const unit = units[i]
    const attempted: string[] = []
    for (const referralId of unit.referralIds) {
      // At least one referral per unit per run, so a huge referrer still makes progress.
      if (attempted.length > 0 && opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) break
      attempted.push(referralId)
      try {
        await d.refresh(referralId)
        result.refreshed++
      } catch (error) {
        result.failed++
        d.report(error, { area: 'referral', step: 'reconcile_refresh', extra: { referralId } })
      }
    }
    // Runs even when a refresh failed: the sync recomputes from stored state.
    try {
      await d.sync(unit.referrerTenantId, { reason: 'reconcile' })
      result.synced++
    } catch (error) {
      result.failed++
      d.report(error, { area: 'referral', step: 'reconcile_sync', extra: { referrerTenantId: unit.referrerTenantId } })
    }
    try {
      await d.markReconciled(attempted, opts.now ?? new Date())
    } catch (error) {
      d.report(error, { area: 'referral', step: 'reconcile_mark', extra: { referrerTenantId: unit.referrerTenantId } })
    }
    if (attempted.length < unit.referralIds.length) {
      result.skipped = units.length - i
      break
    }
  }
  return result
}

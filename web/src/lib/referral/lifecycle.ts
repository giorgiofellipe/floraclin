import type Stripe from 'stripe'
import {
  bindReferralSubscription,
  getReferralByReferredTenant,
  getReferralContext,
  getTenantNames,
  loadCandidateTenants,
  loadTenantSignals,
  markReferralIneligible,
  recordCardFingerprints,
  updateReferralState,
  type ReferralContext,
  type TenantReferral,
} from '@/db/queries/referrals'
import { notifyDiscord } from '@/lib/discord'
import { reportSideEffectFailure } from '@/lib/observability'
import {
  findEarliestSubscriptionId,
  listCustomerCardSightings,
  listPaidSubscriptionInvoices,
  retrieveSubscriptionOrMissing,
  type PaidInvoiceSummary,
} from '@/lib/stripe'
import { effectiveSubscriptionStatus } from '@/lib/subscription-access'
import { announceReferralStatusChange } from './announce'
import { runEligibilityChecks } from './eligibility'
import { computeReferralStatus, isTerminalStatus, type ReferredSnapshot } from './status'
import { stripeSubscriptionIsMonthly } from './subscription-state'
import type {
  CardSighting,
  IneligibleReason,
  PausedReason,
  ReferralChecks,
  ReferralState,
  ReferralStatus,
  RewardEventReason,
} from './types'

export interface LifecycleDeps {
  now(): Date
  getContext(referralId: string): Promise<ReferralContext | null>
  retrieveSubscription(id: string): Promise<Stripe.Subscription | 'missing'>
  listPaidInvoices(subscriptionId: string): Promise<PaidInvoiceSummary[]>
  listCardSightings(customerId: string): Promise<CardSighting[]>
  findEarliestSubscription(customerId: string): Promise<string | null>
  bindSubscription(referralId: string, subId: string): Promise<string | null>
  recordCardFingerprints(tenantId: string, sightings: CardSighting[]): Promise<void>
  loadSignals: typeof loadTenantSignals
  loadCandidates: typeof loadCandidateTenants
  runChecks: typeof runEligibilityChecks
  saveState(id: string, expectedVersion: number, next: ReferralState, checks?: ReferralChecks): Promise<boolean>
  findByReferredTenant(tenantId: string): Promise<TenantReferral | null>
  markIneligible(
    id: string,
    reason: IneligibleReason,
    note?: string,
    checks?: ReferralChecks,
  ): Promise<TenantReferral | null>
  tenantNames: typeof getTenantNames
  notifyDiscord: typeof notifyDiscord
  report: typeof reportSideEffectFailure
}

export interface RefreshResult {
  referralId: string
  referrerTenantId: string
  previous: ReferralStatus
  next: ReferralStatus
  changed: boolean
  /** Reason passed to syncReferrerReward. */
  rewardReason: RewardEventReason | null
}

const defaultDeps: LifecycleDeps = {
  now: () => new Date(),
  getContext: getReferralContext,
  retrieveSubscription: retrieveSubscriptionOrMissing,
  listPaidInvoices: listPaidSubscriptionInvoices,
  listCardSightings: listCustomerCardSightings,
  findEarliestSubscription: findEarliestSubscriptionId,
  bindSubscription: bindReferralSubscription,
  recordCardFingerprints,
  loadSignals: loadTenantSignals,
  loadCandidates: loadCandidateTenants,
  runChecks: runEligibilityChecks,
  saveState: updateReferralState,
  findByReferredTenant: getReferralByReferredTenant,
  markIneligible: markReferralIneligible,
  tenantNames: getTenantNames,
  notifyDiscord,
  report: reportSideEffectFailure,
}

type StripePart = NonNullable<ReferredSnapshot['stripe']>

/** Pure: snapshot from Stripe objects. */
export function buildStripeSnapshotPart(
  sub: Stripe.Subscription | 'missing',
  subscriptionId: string,
  invoices: PaidInvoiceSummary[],
): StripePart {
  let firstPaidAt: Date | null = null
  let qualifyingInvoice: StripePart['qualifyingInvoice'] = null
  for (const inv of invoices) {
    if (!inv.paidAt) continue
    if (!firstPaidAt || inv.paidAt < firstPaidAt) firstPaidAt = inv.paidAt
    if (
      inv.billingReason === 'subscription_cycle' &&
      inv.amountPaid > 0 &&
      (!qualifyingInvoice || inv.paidAt < qualifyingInvoice.paidAt)
    ) {
      qualifyingInvoice = { id: inv.id, paidAt: inv.paidAt }
    }
  }
  return {
    subscriptionId,
    status: sub === 'missing' ? 'missing' : sub.status,
    cancelAtPeriodEnd: sub === 'missing' ? false : Boolean(sub.cancel_at_period_end),
    monthly: sub === 'missing' ? false : stripeSubscriptionIsMonthly(sub),
    firstPaidAt,
    qualifyingInvoice,
  }
}

/** Pure: status change → reward-event reason (null when the change can't move the count). */
export function rewardReasonFor(previous: ReferralStatus, next: ReferralStatus): RewardEventReason | null {
  if (previous === next) return null
  if (next === 'counting') return 'referral_counting'
  if (previous === 'counting' && (next === 'paused' || next === 'first_paid')) return 'referral_paused'
  if ((previous === 'counting' || previous === 'paused') && (next === 'canceled' || next === 'ineligible')) {
    return 'referral_canceled'
  }
  return null
}

const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

function sameState(a: ReferralState, b: ReferralState): boolean {
  return (
    a.status === b.status &&
    a.pausedReason === b.pausedReason &&
    a.ineligibleReason === b.ineligibleReason &&
    a.stripeSubscriptionId === b.stripeSubscriptionId &&
    a.qualifyingInvoiceId === b.qualifyingInvoiceId &&
    sameDate(a.firstPaidAt, b.firstPaidAt) &&
    sameDate(a.qualifiedAt, b.qualifiedAt) &&
    sameDate(a.endedAt, b.endedAt)
  )
}

function stateOf(r: TenantReferral): ReferralState {
  return {
    status: r.status as ReferralStatus,
    pausedReason: (r.pausedReason as PausedReason | null) ?? null,
    ineligibleReason: (r.ineligibleReason as IneligibleReason | null) ?? null,
    stripeSubscriptionId: r.stripeSubscriptionId ?? null,
    firstPaidAt: r.firstPaidAt ?? null,
    qualifiedAt: r.qualifiedAt ?? null,
    qualifyingInvoiceId: r.qualifyingInvoiceId ?? null,
    endedAt: r.endedAt ?? null,
  }
}

function unchanged(r: TenantReferral): RefreshResult {
  const status = r.status as ReferralStatus
  return {
    referralId: r.id,
    referrerTenantId: r.referrerTenantId,
    previous: status,
    next: status,
    changed: false,
    rewardReason: null,
  }
}

export async function recordTenantCardFingerprints(
  tenantId: string,
  customerId: string,
  deps: Partial<LifecycleDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps }
  await d.recordCardFingerprints(tenantId, await d.listCardSightings(customerId))
}

/** One pass (steps 1–7). `null` in the second slot means the optimistic write lost. */
async function refreshOnce(referralId: string, d: LifecycleDeps): Promise<RefreshResult | null | 'lost'> {
  let ctx = await d.getContext(referralId)
  if (!ctx) return null
  if (isTerminalStatus(ctx.referral.status as ReferralStatus)) return unchanged(ctx.referral)

  const now = d.now()
  const customerId = ctx.referredSub?.stripeCustomerId ?? null

  // Bind the customer's earliest subscription; never the tenant row's current one.
  let subId = ctx.referral.stripeSubscriptionId ?? null
  if (!subId && customerId) {
    const earliest = await d.findEarliestSubscription(customerId)
    if (earliest) {
      subId = await d.bindSubscription(referralId, earliest)
      const reloaded = await d.getContext(referralId)
      if (!reloaded) return null
      ctx = reloaded
    }
  }

  const referral = ctx.referral
  const prev = stateOf(referral)
  const localTrialEnded =
    !subId &&
    ctx.referredSub != null &&
    effectiveSubscriptionStatus(
      {
        status: ctx.referredSub.status,
        source: ctx.referredSub.source,
        stripeSubscriptionId: ctx.referredSub.stripeSubscriptionId,
        currentPeriodEnd: ctx.referredSub.currentPeriodEnd,
      },
      now,
    ) === 'expired'

  let stripePart: StripePart | null = null
  if (subId) {
    const sub = await d.retrieveSubscription(subId)
    const invoices = await d.listPaidInvoices(subId)
    stripePart = buildStripeSnapshotPart(sub, subId, invoices)
  }

  const snap: ReferredSnapshot = {
    now,
    tenantDeleted: ctx.referredDeleted,
    localTrialEnded,
    stripe: stripePart,
    ineligible: null,
  }

  let checks: ReferralChecks | undefined
  if (prev.qualifiedAt == null && stripePart?.qualifyingInvoice) {
    // Record the cards first so loadSignals/loadCandidates see them.
    if (customerId) await recordTenantCardFingerprints(referral.referredTenantId, customerId, d)
    if (ctx.referrerCustomerId) await recordTenantCardFingerprints(referral.referrerTenantId, ctx.referrerCustomerId, d)
    const { verdict, selfReferral, notNew } = await d.runChecks(
      {
        referredTenantId: referral.referredTenantId,
        referrerTenantId: referral.referrerTenantId,
        referredSignupAt: ctx.referredSignupAt,
        stage: 'qualification',
      },
      { loadSignals: d.loadSignals, loadCandidates: d.loadCandidates },
    )
    snap.ineligible = verdict
    checks = { atQualification: { selfReferral, notNew } }
  }

  const next = computeReferralStatus(prev, snap)
  if (sameState(prev, next)) return unchanged(referral)

  const saved = await d.saveState(referral.id, referral.version, next, checks)
  if (!saved) return 'lost'
  if (prev.status !== next.status || prev.pausedReason !== next.pausedReason) {
    await announceReferralStatusChange(referral, next, {}, d)
  }
  return {
    referralId: referral.id,
    referrerTenantId: referral.referrerTenantId,
    previous: prev.status,
    next: next.status,
    changed: true,
    rewardReason: rewardReasonFor(prev.status, next.status),
  }
}

export async function refreshReferral(
  referralId: string,
  deps: Partial<LifecycleDeps> = {},
): Promise<RefreshResult | null> {
  const d = { ...defaultDeps, ...deps }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await refreshOnce(referralId, d)
    if (res !== 'lost') return res
  }
  // Lost twice: the other writer's own sync covers it.
  const latest = await d.getContext(referralId)
  return latest ? unchanged(latest.referral) : null
}

export async function markReferralChargeback(
  referredTenantId: string,
  deps: Partial<LifecycleDeps> = {},
): Promise<RefreshResult | null> {
  const d = { ...defaultDeps, ...deps }
  const referral = await d.findByReferredTenant(referredTenantId)
  if (!referral) return null
  const previous = referral.status as ReferralStatus
  if (previous === 'ineligible') return unchanged(referral)
  const updated = await d.markIneligible(referral.id, 'chargeback')
  if (!updated) return unchanged(referral)
  await announceReferralStatusChange(referral, updated, {}, d)
  return {
    referralId: referral.id,
    referrerTenantId: referral.referrerTenantId,
    previous,
    next: 'ineligible',
    changed: true,
    rewardReason: rewardReasonFor(previous, 'ineligible'),
  }
}

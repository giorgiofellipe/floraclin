import type Stripe from 'stripe'
import {
  countCountingReferrals,
  getReferralSummary,
  getReferrerBilling,
  getTenantNames,
  recordRewardStateIfChanged,
  withReferrerRewardLock,
  type DbExecutor,
  type ReferrerBilling,
} from '@/db/queries/referrals'
import { raiseReferralBonus } from '@/db/queries/whatsapp-credits'
import { notifyDiscord } from '@/lib/discord'
import { reportSideEffectFailure } from '@/lib/observability'
import {
  listOpenCycleDrafts,
  retrieveInvoiceWithDiscounts,
  retrieveSubscriptionOrMissing,
  updateInvoiceDiscounts,
  updateSubscriptionDiscounts,
  referrerCouponsMatchTerms,
} from '@/lib/stripe'
import {
  areReferralRewardsActive,
  couponIdForPercent,
  isReferrerCoupon,
  referrerCouponIds,
  type ReferrerCouponIds,
} from './config'
import { sendReferralRewardEmail, type RewardEmailInput } from './emails'
import { referralBonusCredits, referralDiscountPercent, type ReferralPercent } from './rules'
import { referrerSubscriptionState } from './subscription-state'
import type { ReferralStatus, RewardEventReason } from './types'

type Env = Record<string, string | undefined>

export interface RewardDeps {
  now(): Date
  env: Env
  /** The whole sync body runs inside this lock. */
  withLock<T>(referrerTenantId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T>
  countCounting(referrerTenantId: string, tx: DbExecutor): Promise<number>
  getBilling(tenantId: string, tx: DbExecutor): Promise<ReferrerBilling | null>
  retrieveSubscription(subId: string): Promise<Stripe.Subscription | 'missing'>
  updateSubscriptionDiscounts(subId: string, discounts: Stripe.SubscriptionUpdateParams.Discount[]): Promise<unknown>
  listOpenDrafts(subId: string): Promise<Stripe.Invoice[]>
  retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice>
  updateInvoiceDiscounts(invoiceId: string, discounts: Stripe.InvoiceUpdateParams.Discount[]): Promise<unknown>
  raiseBonus(tenantId: string, target: number, tx: DbExecutor): Promise<{ bonusCredits: number }>
  recordState(
    input: Parameters<typeof recordRewardStateIfChanged>[0],
    tx: DbExecutor,
  ): ReturnType<typeof recordRewardStateIfChanged>
  notify(input: RewardEmailInput): Promise<void>
  getReferral(id: string): Promise<{ id: string; referredName: string; status: ReferralStatus } | null>
  report: typeof reportSideEffectFailure
  tenantNames: typeof getTenantNames
  notifyDiscord: typeof notifyDiscord
  couponsMatchTerms: typeof referrerCouponsMatchTerms
}

export interface SyncTrigger {
  reason: RewardEventReason
  referralId?: string | null
  /** invoice.created: this draft is repaired even if the draft list hasn't caught up yet. */
  draftInvoiceId?: string | null
}

export type RewardSyncResult =
  | { skipped: 'not_configured' | 'misconfigured' }
  | {
      skipped?: undefined
      counting: number
      targetPercent: ReferralPercent
      targetCouponId: string | null
      updatable: boolean
      eligible: boolean
      stripeUpdated: boolean
      draftsUpdated: string[]
      bonusTarget: number
      eventRecorded: boolean
      subscriptionId: string | null
    }

const defaultDeps: RewardDeps = {
  now: () => new Date(),
  env: process.env,
  withLock: withReferrerRewardLock,
  countCounting: countCountingReferrals,
  getBilling: getReferrerBilling,
  retrieveSubscription: retrieveSubscriptionOrMissing,
  updateSubscriptionDiscounts,
  listOpenDrafts: listOpenCycleDrafts,
  retrieveInvoice: retrieveInvoiceWithDiscounts,
  updateInvoiceDiscounts,
  raiseBonus: raiseReferralBonus,
  recordState: recordRewardStateIfChanged,
  notify: sendReferralRewardEmail,
  getReferral: getReferralSummary,
  report: reportSideEffectFailure,
  tenantNames: getTenantNames,
  notifyDiscord,
  couponsMatchTerms: referrerCouponsMatchTerms,
}

/** Pure: the percent a given invoice instant is entitled to. */
export function percentAt(
  at: Date,
  input: { eligible: boolean; counting: number },
  env: Env,
): ReferralPercent {
  return areReferralRewardsActive(env, at) && input.eligible ? referralDiscountPercent(input.counting) : 0
}

/** Pure: keep every discount we don't own (as { discount: id }), replace/remove ours. */
export function planReferralDiscounts(
  current: Array<string | Stripe.Discount | Stripe.DeletedDiscount>,
  targetCouponId: string | null,
  ids: ReferrerCouponIds,
): {
  changed: boolean
  discounts: Array<{ discount: string } | { coupon: string }>
  currentReferralCouponId: string | null
} {
  const foreign: Array<{ discount: string }> = []
  const ours: Array<{ discountId: string; couponId: string | null }> = []
  for (const entry of current) {
    if (typeof entry === 'string') {
      foreign.push({ discount: entry })
      continue
    }
    if (entry.deleted) continue
    const coupon = entry.source?.coupon ?? null
    if (coupon === null) {
      foreign.push({ discount: entry.id })
      continue
    }
    const couponId = typeof coupon === 'string' ? coupon : coupon.id
    const meta = typeof coupon === 'string' ? null : coupon.metadata
    if (isReferrerCoupon({ id: couponId, metadata: meta }, ids)) ours.push({ discountId: entry.id, couponId })
    else foreign.push({ discount: entry.id })
  }

  const currentReferralCouponId = ours[0]?.couponId ?? null
  const changed =
    targetCouponId === null
      ? ours.length > 0
      : ours.length !== 1 || ours[0].couponId !== targetCouponId

  if (!changed) {
    return {
      changed,
      discounts: [...foreign, ...ours.map((o) => ({ discount: o.discountId }))],
      currentReferralCouponId,
    }
  }
  return {
    changed,
    discounts: targetCouponId === null ? foreign : [...foreign, { coupon: targetCouponId }],
    currentReferralCouponId,
  }
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

function isInvoiceNotEditable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  if (e?.code === 'invoice_not_editable') return true
  return typeof e?.message === 'string' && /no longer editable|not editable/i.test(e.message)
}

/**
 * Recomputes the referrer's reward from the DB count and the Stripe subscription, and makes Stripe
 * (subscription + open cycle drafts) and the WhatsApp bonus match. Runs entirely under the per-referrer lock.
 * Does not read REFERRAL_ENROLLMENT_ENABLED: rewards keep syncing when new enrollment is off.
 */
export async function syncReferrerReward(
  referrerTenantId: string,
  trigger: SyncTrigger,
  deps: Partial<RewardDeps> = {},
): Promise<RewardSyncResult> {
  const d: RewardDeps = { ...defaultDeps, ...deps }
  const ids = referrerCouponIds(d.env)
  if (!ids) return { skipped: 'not_configured' }
  if (!(await d.couponsMatchTerms(ids))) {
    d.report(new Error('STRIPE_REFERRER_COUPON_IDS do not match their percents'), {
      area: 'referral',
      step: 'referrer_coupons_misconfigured',
      extra: { referrerTenantId },
    })
    return { skipped: 'misconfigured' }
  }

  const locked = await d.withLock(referrerTenantId, async (tx) => {
    const counting = await d.countCounting(referrerTenantId, tx)
    const billing = await d.getBilling(referrerTenantId, tx)
    const sub = billing?.stripeSubscriptionId ? await d.retrieveSubscription(billing.stripeSubscriptionId) : null
    const { updatable, eligible } = referrerSubscriptionState(sub, billing?.source)

    const now = d.now()
    const targetPercent = percentAt(now, { eligible, counting }, d.env)
    const targetCouponId = couponIdForPercent(targetPercent, ids)

    let stripeUpdated = false
    const draftsUpdated: string[] = []
    if (updatable && sub && sub !== 'missing') {
      const plan = planReferralDiscounts(sub.discounts, targetCouponId, ids)
      if (plan.changed) {
        await d.updateSubscriptionDiscounts(sub.id, plan.discounts)
        stripeUpdated = true
      }

      const drafts = await d.listOpenDrafts(sub.id)
      if (trigger.draftInvoiceId && !drafts.some((draft) => draft.id === trigger.draftInvoiceId)) {
        drafts.push(await d.retrieveInvoice(trigger.draftInvoiceId))
      }
      for (const draft of drafts) {
        if (
          draft.status !== 'draft' ||
          draft.billing_reason !== 'subscription_cycle' ||
          invoiceSubscriptionId(draft) !== sub.id
        ) {
          continue
        }
        const draftPercent = percentAt(new Date(draft.created * 1000), { eligible, counting }, d.env)
        const dplan = planReferralDiscounts(draft.discounts, couponIdForPercent(draftPercent, ids), ids)
        if (!dplan.changed) continue
        try {
          await d.updateInvoiceDiscounts(draft.id!, dplan.discounts)
          draftsUpdated.push(draft.id!)
        } catch (err) {
          if (!isInvoiceNotEditable(err)) throw err
          d.report(err, { area: 'referral', step: 'draft_not_editable', extra: { invoiceId: draft.id } })
        }
      }
    }

    const bonusTarget =
      eligible && billing && areReferralRewardsActive(d.env, now)
        ? referralBonusCredits(counting, billing.whatsappLimit)
        : 0
    if (bonusTarget > 0) await d.raiseBonus(referrerTenantId, bonusTarget, tx)

    const subscriptionId = updatable && sub && sub !== 'missing' ? sub.id : null
    const recorded = await d.recordState(
      {
        referrerTenantId,
        counting,
        discountPercent: targetPercent,
        bonusCredits: bonusTarget,
        stripeSubscriptionId: subscriptionId,
        reason: trigger.reason,
        referralId: trigger.referralId ?? null,
      },
      tx,
    )
    return {
      counting,
      targetPercent,
      targetCouponId,
      updatable,
      eligible,
      stripeUpdated,
      draftsUpdated,
      bonusTarget,
      eventRecorded: recorded.inserted,
      subscriptionId,
      previous: recorded.previous,
    }
  })

  const { previous, ...result } = locked
  const changedForUser = previous
    ? previous.discountPercent !== result.targetPercent || previous.bonusCredits !== result.bonusTarget
    : result.targetPercent > 0 || result.bonusTarget > 0
  if (result.eventRecorded && changedForUser) {
    try {
      const referral = trigger.referralId ? await d.getReferral(trigger.referralId) : null
      await d.notify({
        referrerTenantId,
        previous: previous
          ? { discountPercent: previous.discountPercent, bonusCredits: previous.bonusCredits }
          : null,
        current: {
          discountPercent: result.targetPercent,
          bonusCredits: result.bonusTarget,
          counting: result.counting,
        },
        referral: referral
          ? { referredName: referral.referredName, nowCounting: referral.status === 'counting' }
          : null,
      })
    } catch (err) {
      d.report(err, { area: 'referral', step: 'reward_email', extra: { referrerTenantId } })
    }
  }
  const current = { counting: result.counting, discountPercent: result.targetPercent, bonusCredits: result.bonusTarget }
  const rewardMoved = previous
    ? previous.counting !== current.counting || previous.discountPercent !== current.discountPercent ||
      previous.bonusCredits !== current.bonusCredits
    : current.counting > 0 || current.discountPercent > 0 || current.bonusCredits > 0
  if (result.eventRecorded && rewardMoved) {
    try {
      const names = await d.tenantNames([referrerTenantId])
      await d.notifyDiscord({
        kind: 'referral.reward_changed',
        referrerName: names[referrerTenantId] ?? referrerTenantId,
        referrerTenantId,
        previous: previous
          ? { counting: previous.counting, discountPercent: previous.discountPercent, bonusCredits: previous.bonusCredits }
          : null,
        current,
      })
    } catch (err) {
      d.report(err, { area: 'referral', step: 'discord_reward_changed', extra: { referrerTenantId } })
    }
  }
  return result
}

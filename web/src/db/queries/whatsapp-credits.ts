import { db } from '@/db/client'
import {
  whatsappCredits,
  whatsappCreditLedger,
  tenantSubscriptions,
  plans,
  referralRewardEvents,
} from '@/db/schema'
import { eq, and, lte, sql, desc } from 'drizzle-orm'
import { brToday, parseBrDate } from '@/lib/dates'
import { addMonths } from 'date-fns'
import { UNLIMITED_CREDITS, periodCreditsTotal } from '@/lib/whatsapp-credits'
import { areReferralRewardsActive } from '@/lib/referral/config'
import { reportSideEffectFailure } from '@/lib/observability'

// ─── TYPES ────────────────────────────────────────────────────────

type CreditPeriod = {
  id: string
  creditsTotal: number
  creditsUsed: number
  bonusCredits: number
  periodStart: Date
  periodEnd: Date
}

export type LedgerSpendInput = {
  actorType: 'user' | 'patient' | 'system'
  actorUserId: string | null
  patientId: string | null
  conversationId: string | null
  contactName: string | null
  contactPhone: string
  itemKind: 'template' | 'text' | 'media' | 'document'
  templateName: string | null
  purposeKey: string | null
  documentLabel: string | null
}

export type SpendResult =
  | { allowed: true; spendId: string; creditsUsed: number; creditsTotal: number }
  | { allowed: false; creditsUsed: number; creditsTotal: number }

type CreditUsage = {
  used: number
  total: number
  bonus: number
  periodEnd: Date
}

// ─── PERIOD MANAGEMENT ───────────────────────────────────────────

/**
 * Bonus a tenant starts a new period with: the latest reward event written by
 * `syncReferrerReward`, which already encodes every eligibility rule. Never throws.
 */
async function initialReferralBonus(
  tenantId: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  exec: typeof db = db,
): Promise<number> {
  if (!areReferralRewardsActive(env, now)) return 0
  try {
    const [latest] = await exec
      .select({ bonusCredits: referralRewardEvents.bonusCredits })
      .from(referralRewardEvents)
      .where(eq(referralRewardEvents.referrerTenantId, tenantId))
      .orderBy(desc(referralRewardEvents.createdAt))
      .limit(1)
    return latest?.bonusCredits ?? 0
  } catch (error) {
    reportSideEffectFailure(error, { area: 'referral', step: 'initial-bonus', extra: { tenantId } })
    return 0
  }
}

export async function getOrCreateCurrentPeriod(tenantId: string, exec: typeof db = db): Promise<CreditPeriod> {
  const today = brToday()
  const year = today.slice(0, 4)
  const month = today.slice(5, 7)

  const periodStartYmd = `${year}-${month}-01`
  const periodStart = parseBrDate(periodStartYmd, '00:00:00')
  const periodEnd = addMonths(periodStart, 1)

  const [existing] = await exec
    .select()
    .from(whatsappCredits)
    .where(
      and(
        eq(whatsappCredits.tenantId, tenantId),
        eq(whatsappCredits.periodStart, periodStart)
      )
    )
    .limit(1)

  const [sub] = await exec
    .select({ limits: plans.limits })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  const limits = (sub?.limits ?? {}) as Record<string, number>
  const planLimit = limits.whatsapp_credits ?? 0

  if (existing) {
    // Computed in SQL from the stored bonus so a concurrent raiseReferralBonus is never undone.
    const total = sql`CASE WHEN ${planLimit} = -1 THEN -1 ELSE ${planLimit} + ${whatsappCredits.bonusCredits} END`
    const [updated] = await exec
      .update(whatsappCredits)
      .set({ creditsTotal: total, updatedAt: new Date() })
      .where(and(
        eq(whatsappCredits.id, existing.id),
        sql`${whatsappCredits.creditsTotal} IS DISTINCT FROM (${total})`,
      ))
      .returning({ creditsTotal: whatsappCredits.creditsTotal, bonusCredits: whatsappCredits.bonusCredits })
    return {
      id: existing.id,
      creditsTotal: updated ? updated.creditsTotal : periodCreditsTotal(planLimit, existing.bonusCredits),
      creditsUsed: existing.creditsUsed,
      bonusCredits: updated ? updated.bonusCredits : existing.bonusCredits,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    }
  }

  const bonus = await initialReferralBonus(tenantId, new Date(), process.env, exec)
  const [created] = await exec
    .insert(whatsappCredits)
    .values({
      tenantId,
      periodStart,
      periodEnd,
      creditsTotal: periodCreditsTotal(planLimit, bonus),
      creditsUsed: 0,
      bonusCredits: bonus,
      bonusSource: bonus > 0 ? 'referral' : null,
    })
    .onConflictDoNothing()
    .returning()

  if (created) {
    return {
      id: created.id,
      creditsTotal: created.creditsTotal,
      creditsUsed: created.creditsUsed,
      bonusCredits: created.bonusCredits,
      periodStart: created.periodStart,
      periodEnd: created.periodEnd,
    }
  }

  // Race condition: another request created the row between our SELECT and INSERT
  const [raced] = await exec
    .select()
    .from(whatsappCredits)
    .where(
      and(
        eq(whatsappCredits.tenantId, tenantId),
        eq(whatsappCredits.periodStart, periodStart)
      )
    )
    .limit(1)

  return {
    id: raced.id,
    creditsTotal: raced.creditsTotal,
    creditsUsed: raced.creditsUsed,
    bonusCredits: raced.bonusCredits,
    periodStart: raced.periodStart,
    periodEnd: raced.periodEnd,
  }
}

/**
 * §7: the bonus only rises within a month. Ensures the current period exists, then raises
 * `bonus_credits` to `target` and moves `credits_total` by the difference (unlimited stays -1).
 * `exec` is the reward lock's tx (P-18).
 */
export async function raiseReferralBonus(
  tenantId: string,
  target: number,
  exec: typeof db = db,
): Promise<{ bonusCredits: number; creditsTotal: number }> {
  const period = await getOrCreateCurrentPeriod(tenantId, exec)
  if (target <= 0) return { bonusCredits: period.bonusCredits, creditsTotal: period.creditsTotal }

  const raised = sql`GREATEST(${whatsappCredits.bonusCredits}, ${target})`
  const [updated] = await exec
    .update(whatsappCredits)
    .set({
      bonusCredits: raised,
      bonusSource: sql`CASE WHEN ${raised} > 0 THEN 'referral' ELSE ${whatsappCredits.bonusSource} END`,
      creditsTotal: sql`CASE WHEN ${whatsappCredits.creditsTotal} = -1 THEN -1 ELSE ${whatsappCredits.creditsTotal} - ${whatsappCredits.bonusCredits} + ${raised} END`,
      updatedAt: new Date(),
    })
    .where(eq(whatsappCredits.id, period.id))
    .returning({ bonusCredits: whatsappCredits.bonusCredits, creditsTotal: whatsappCredits.creditsTotal })
  return updated ?? { bonusCredits: period.bonusCredits, creditsTotal: period.creditsTotal }
}

// ─── CREDIT CONSUMPTION ──────────────────────────────────────────

export async function spendCredits(tenantId: string, cost: number, entry: LedgerSpendInput): Promise<SpendResult> {
  const credits = await getOrCreateCurrentPeriod(tenantId)
  const unlimited = credits.creditsTotal === UNLIMITED_CREDITS
  const denied = { allowed: false as const, creditsUsed: credits.creditsUsed, creditsTotal: credits.creditsTotal }
  if (!unlimited && credits.creditsUsed + cost > credits.creditsTotal) return denied

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(whatsappCredits)
      .set({ creditsUsed: sql`${whatsappCredits.creditsUsed} + ${cost}`, updatedAt: new Date() })
      .where(and(
        eq(whatsappCredits.id, credits.id),
        unlimited ? undefined : lte(sql`${whatsappCredits.creditsUsed} + ${cost}`, whatsappCredits.creditsTotal),
      ))
      .returning()
    if (!updated) return denied

    const [line] = await tx
      .insert(whatsappCreditLedger)
      .values({ tenantId, creditPeriodId: updated.id, kind: 'spend', amount: -cost, ...entry })
      .returning({ id: whatsappCreditLedger.id })

    return { allowed: true as const, spendId: line.id, creditsUsed: updated.creditsUsed, creditsTotal: updated.creditsTotal }
  })
}

export async function attachMetaMessageId(spendId: string, metaMessageId: string): Promise<void> {
  await db.update(whatsappCreditLedger).set({ metaMessageId }).where(eq(whatsappCreditLedger.id, spendId))
}

export async function refundSpend(spendId: string, reason: 'send_failed' | 'delivery_failed'): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [spend] = await tx.select().from(whatsappCreditLedger)
      .where(and(eq(whatsappCreditLedger.id, spendId), eq(whatsappCreditLedger.kind, 'spend')))
    if (!spend) return false
    const cost = -spend.amount

    const [refund] = await tx
      .insert(whatsappCreditLedger)
      .values({
        tenantId: spend.tenantId,
        creditPeriodId: spend.creditPeriodId,
        kind: 'refund',
        amount: cost,
        refundOf: spend.id,
        refundReason: reason,
        actorType: spend.actorType,
        actorUserId: spend.actorUserId,
        patientId: spend.patientId,
        conversationId: spend.conversationId,
        contactName: spend.contactName,
        contactPhone: spend.contactPhone,
        itemKind: spend.itemKind,
        templateName: spend.templateName,
        purposeKey: spend.purposeKey,
        documentLabel: spend.documentLabel,
      })
      .onConflictDoNothing()
      .returning({ id: whatsappCreditLedger.id })
    if (!refund) return false

    await tx
      .update(whatsappCredits)
      .set({ creditsUsed: sql`greatest(${whatsappCredits.creditsUsed} - ${cost}, 0)`, updatedAt: new Date() })
      .where(eq(whatsappCredits.id, spend.creditPeriodId))
    return true
  })
}

export async function refundSpendByMetaMessageId(tenantId: string, metaMessageId: string): Promise<boolean> {
  const [spend] = await db.select({ id: whatsappCreditLedger.id }).from(whatsappCreditLedger)
    .where(and(
      eq(whatsappCreditLedger.tenantId, tenantId),
      eq(whatsappCreditLedger.metaMessageId, metaMessageId),
      eq(whatsappCreditLedger.kind, 'spend'),
    ))
  if (!spend) return false
  return refundSpend(spend.id, 'delivery_failed')
}

// ─── USAGE QUERY ─────────────────────────────────────────────────

export async function getCreditUsage(tenantId: string): Promise<CreditUsage> {
  const credits = await getOrCreateCurrentPeriod(tenantId)
  return {
    used: credits.creditsUsed,
    total: credits.creditsTotal,
    bonus: credits.bonusCredits,
    periodEnd: credits.periodEnd,
  }
}

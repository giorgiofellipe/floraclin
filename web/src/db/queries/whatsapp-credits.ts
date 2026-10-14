import { db } from '@/db/client'
import {
  whatsappCredits,
  tenantSubscriptions,
  plans,
} from '@/db/schema'
import { eq, and, lte, sql } from 'drizzle-orm'
import { brToday, parseBrDate } from '@/lib/dates'
import { addMonths } from 'date-fns'
import { UNLIMITED_CREDITS } from '@/lib/whatsapp-credits'

// ─── TYPES ────────────────────────────────────────────────────────

type CreditPeriod = {
  id: string
  creditsTotal: number
  creditsUsed: number
  periodStart: Date
  periodEnd: Date
}

type ConsumeResult =
  | { allowed: true; periodId: string; creditsUsed: number; creditsTotal: number }
  | { allowed: false; creditsUsed: number; creditsTotal: number }

type CreditUsage = {
  used: number
  total: number
  periodEnd: Date
}

// ─── PERIOD MANAGEMENT ───────────────────────────────────────────

export async function getOrCreateCurrentPeriod(tenantId: string): Promise<CreditPeriod> {
  const today = brToday()
  const year = today.slice(0, 4)
  const month = today.slice(5, 7)

  const periodStartYmd = `${year}-${month}-01`
  const periodStart = parseBrDate(periodStartYmd, '00:00:00')
  const periodEnd = addMonths(periodStart, 1)

  const [existing] = await db
    .select()
    .from(whatsappCredits)
    .where(
      and(
        eq(whatsappCredits.tenantId, tenantId),
        eq(whatsappCredits.periodStart, periodStart)
      )
    )
    .limit(1)

  const [sub] = await db
    .select({ limits: plans.limits })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  const limits = (sub?.limits ?? {}) as Record<string, number>
  const creditsTotal = limits.whatsapp_conversations ?? 0

  if (existing) {
    if (existing.creditsTotal !== creditsTotal) {
      await db
        .update(whatsappCredits)
        .set({ creditsTotal, updatedAt: new Date() })
        .where(eq(whatsappCredits.id, existing.id))
    }
    return {
      id: existing.id,
      creditsTotal,
      creditsUsed: existing.creditsUsed,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    }
  }

  const [created] = await db
    .insert(whatsappCredits)
    .values({
      tenantId,
      periodStart,
      periodEnd,
      creditsTotal,
      creditsUsed: 0,
    })
    .onConflictDoNothing()
    .returning()

  if (created) {
    return {
      id: created.id,
      creditsTotal: created.creditsTotal,
      creditsUsed: created.creditsUsed,
      periodStart: created.periodStart,
      periodEnd: created.periodEnd,
    }
  }

  // Race condition: another request created the row between our SELECT and INSERT
  const [raced] = await db
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
    periodStart: raced.periodStart,
    periodEnd: raced.periodEnd,
  }
}

// ─── CREDIT CONSUMPTION ──────────────────────────────────────────

export async function consumeCredits(tenantId: string, cost: number): Promise<ConsumeResult> {
  const credits = await getOrCreateCurrentPeriod(tenantId)
  const unlimited = credits.creditsTotal === UNLIMITED_CREDITS
  const denied = {
    allowed: false as const,
    creditsUsed: credits.creditsUsed,
    creditsTotal: credits.creditsTotal,
  }

  if (!unlimited && credits.creditsUsed + cost > credits.creditsTotal) return denied

  const [updated] = await db
    .update(whatsappCredits)
    .set({
      creditsUsed: sql`${whatsappCredits.creditsUsed} + ${cost}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappCredits.id, credits.id),
        unlimited
          ? undefined
          : lte(sql`${whatsappCredits.creditsUsed} + ${cost}`, whatsappCredits.creditsTotal)
      )
    )
    .returning()

  if (!updated) return denied

  return {
    allowed: true,
    periodId: updated.id,
    creditsUsed: updated.creditsUsed,
    creditsTotal: updated.creditsTotal,
  }
}

export async function refundCredits(periodId: string, cost: number): Promise<void> {
  await db
    .update(whatsappCredits)
    .set({
      creditsUsed: sql`greatest(${whatsappCredits.creditsUsed} - ${cost}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(whatsappCredits.id, periodId))
}

// ─── USAGE QUERY ─────────────────────────────────────────────────

export async function getCreditUsage(tenantId: string): Promise<CreditUsage> {
  const credits = await getOrCreateCurrentPeriod(tenantId)
  return {
    used: credits.creditsUsed,
    total: credits.creditsTotal,
    periodEnd: credits.periodEnd,
  }
}

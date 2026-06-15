import { db } from '@/db/client'
import {
  whatsappCredits,
  whatsappConversations,
  whatsappMessages,
  tenantSubscriptions,
  plans,
} from '@/db/schema'
import { eq, and, gt, lt, sql } from 'drizzle-orm'
import { normalizeBrPhone } from '@/lib/phone'
import { brToday, parseBrDate } from '@/lib/dates'
import { addMonths } from 'date-fns'

// ─── TYPES ────────────────────────────────────────────────────────

type CreditPeriod = {
  id: string
  creditsTotal: number
  creditsUsed: number
  periodStart: Date
  periodEnd: Date
}

type ConsumeResult = {
  allowed: boolean
  creditsUsed: number
  creditsTotal: number
}

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

  if (existing) {
    return {
      id: existing.id,
      creditsTotal: existing.creditsTotal,
      creditsUsed: existing.creditsUsed,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    }
  }

  const [sub] = await db
    .select({ limits: plans.limits })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  const limits = (sub?.limits ?? {}) as Record<string, number>
  const creditsTotal = limits.whatsapp_conversations ?? 0

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

// ─── OPEN CONVERSATION CHECK ─────────────────────────────────────

export async function findOpenConversation(tenantId: string, phone: string): Promise<boolean> {
  const normalized = normalizeBrPhone(phone)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [row] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .innerJoin(
      whatsappConversations,
      eq(whatsappMessages.conversationId, whatsappConversations.id)
    )
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.phoneNumber, normalized),
        eq(whatsappMessages.direction, 'outbound'),
        gt(whatsappMessages.createdAt, twentyFourHoursAgo)
      )
    )
    .limit(1)

  return !!row
}

// ─── CREDIT CONSUMPTION ──────────────────────────────────────────

export async function consumeCredit(tenantId: string, recipientPhone: string): Promise<ConsumeResult> {
  const hasOpen = await findOpenConversation(tenantId, recipientPhone)

  const credits = await getOrCreateCurrentPeriod(tenantId)

  if (hasOpen) {
    return {
      allowed: true,
      creditsUsed: credits.creditsUsed,
      creditsTotal: credits.creditsTotal,
    }
  }

  if (credits.creditsUsed >= credits.creditsTotal) {
    return {
      allowed: false,
      creditsUsed: credits.creditsUsed,
      creditsTotal: credits.creditsTotal,
    }
  }

  const [updated] = await db
    .update(whatsappCredits)
    .set({
      creditsUsed: sql`${whatsappCredits.creditsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappCredits.id, credits.id),
        lt(whatsappCredits.creditsUsed, whatsappCredits.creditsTotal)
      )
    )
    .returning()

  if (!updated) {
    return {
      allowed: false,
      creditsUsed: credits.creditsTotal,
      creditsTotal: credits.creditsTotal,
    }
  }

  return {
    allowed: true,
    creditsUsed: updated.creditsUsed,
    creditsTotal: updated.creditsTotal,
  }
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

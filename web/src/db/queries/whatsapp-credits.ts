import { db } from '@/db/client'
import {
  whatsappCredits,
  whatsappCreditLedger,
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
  const creditsTotal = limits.whatsapp_credits ?? 0

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

    const [refund] = await tx
      .insert(whatsappCreditLedger)
      .values({
        tenantId: spend.tenantId,
        creditPeriodId: spend.creditPeriodId,
        kind: 'refund',
        amount: -spend.amount,
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
      .set({ creditsUsed: sql`greatest(${whatsappCredits.creditsUsed} - ${-spend.amount}, 0)`, updatedAt: new Date() })
      .where(eq(whatsappCredits.id, spend.creditPeriodId))
    return true
  })
}

export async function refundSpendByMetaMessageId(metaMessageId: string): Promise<boolean> {
  const [spend] = await db.select({ id: whatsappCreditLedger.id }).from(whatsappCreditLedger)
    .where(and(eq(whatsappCreditLedger.metaMessageId, metaMessageId), eq(whatsappCreditLedger.kind, 'spend')))
  if (!spend) return false
  return refundSpend(spend.id, 'delivery_failed')
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

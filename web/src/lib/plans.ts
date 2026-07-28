import { db } from '@/db/client'
import { tenantUsers, patients, whatsappCredits, tenantSubscriptions, plans } from '@/db/schema'
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm'

type PlanLimits = Record<string, number>
type PlanFeatures = Record<string, boolean>

export async function checkPlanLimit(
  tenantId: string,
  limitKey: string
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const sub = await getSubscriptionWithPlan(tenantId)
  if (!sub) return { allowed: false, used: 0, limit: 0 }

  const limits = sub.planLimits as PlanLimits
  const limit = limits[limitKey] ?? 0

  if (limit === -1) {
    const used = await countUsage(tenantId, limitKey)
    return { allowed: true, used, limit: -1 }
  }

  const used = await countUsage(tenantId, limitKey)
  return { allowed: used < limit, used, limit }
}

export async function checkPlanFeature(
  tenantId: string,
  featureKey: string
): Promise<boolean> {
  const sub = await getSubscriptionWithPlan(tenantId)
  if (!sub) return false

  const features = sub.planFeatures as PlanFeatures
  return features[featureKey] === true
}

export async function isSubscriptionActive(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: tenantSubscriptions.status })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  // Tenants created before the subscription system have no row — never
  // lock them out; the migration/backfill is what grants them a trial.
  if (!row) return true
  return row.status === 'trialing' || row.status === 'active'
}

export class SubscriptionExpiredError extends Error {
  constructor() {
    super('Assinatura expirada. Assine um plano para continuar.')
    this.name = 'SubscriptionExpiredError'
  }
}

/** Throws SubscriptionExpiredError when the tenant cannot create new records. */
export async function requireActiveSubscription(tenantId: string): Promise<void> {
  const active = await isSubscriptionActive(tenantId)
  if (!active) throw new SubscriptionExpiredError()
}

/** Standard 402 payload for creation endpoints blocked by expiry. */
export const SUBSCRIPTION_EXPIRED_RESPONSE = {
  body: {
    error: 'Assinatura expirada. Assine um plano para continuar.',
    code: 'subscription_expired',
  },
  status: 402,
} as const

// ─── Internal helpers ──────────────────────────────────────────────

async function getSubscriptionWithPlan(tenantId: string) {
  const [row] = await db
    .select({
      status: tenantSubscriptions.status,
      planLimits: plans.limits,
      planFeatures: plans.features,
      currentPeriodStart: tenantSubscriptions.currentPeriodStart,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
    })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  return row ?? null
}

async function countUsage(tenantId: string, limitKey: string): Promise<number> {
  switch (limitKey) {
    case 'users':
      return countActiveUsers(tenantId)
    case 'patients':
      return countActivePatients(tenantId)
    case 'whatsapp_conversations':
      return countWhatsappCreditsUsed(tenantId)
    default:
      return 0
  }
}

async function countActiveUsers(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.isActive, true)
      )
    )

  return row?.count ?? 0
}

async function countActivePatients(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(
      and(
        eq(patients.tenantId, tenantId),
        isNull(patients.deletedAt)
      )
    )

  return row?.count ?? 0
}

async function countWhatsappCreditsUsed(tenantId: string): Promise<number> {
  const now = new Date()

  const [row] = await db
    .select({ creditsUsed: whatsappCredits.creditsUsed })
    .from(whatsappCredits)
    .where(
      and(
        eq(whatsappCredits.tenantId, tenantId),
        lte(whatsappCredits.periodStart, now),
        gte(whatsappCredits.periodEnd, now)
      )
    )
    .limit(1)

  return row?.creditsUsed ?? 0
}

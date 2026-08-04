import { db } from '@/db/client'
import { plans, tenantSubscriptions, tenants } from '@/db/schema'
import { eq, and, sql, asc, lt } from 'drizzle-orm'
import { addDays, addMonths } from 'date-fns'

// ─── TYPE EXPORTS ──────────────────────────────────────────────────

export type Plan = typeof plans.$inferSelect
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect

export type SubscriptionWithPlan = TenantSubscription & {
  plan: Plan
}

export type SubscriptionListItem = TenantSubscription & {
  tenantName: string
  tenantSlug: string
  planSlug: string
  planName: string
}

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

// ─── PLANS ────────────────────────────────────────────────────────

export async function listPlans(activeOnly = true): Promise<Plan[]> {
  const conditions = activeOnly ? [eq(plans.active, true)] : []

  return db
    .select()
    .from(plans)
    .where(and(...conditions))
    .orderBy(asc(plans.displayOrder))
}

export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, slug))
    .limit(1)

  return plan ?? null
}

export async function createPlan(data: {
  slug: string
  name: string
  priceCents: number
  trialDays?: number | null
  stripePriceId?: string | null
  limits: Record<string, number>
  features: Record<string, boolean>
  displayOrder?: number
}): Promise<Plan> {
  const [plan] = await db
    .insert(plans)
    .values({
      slug: data.slug,
      name: data.name,
      priceCents: data.priceCents,
      trialDays: data.trialDays ?? null,
      stripePriceId: data.stripePriceId ?? null,
      limits: data.limits,
      features: data.features,
      displayOrder: data.displayOrder ?? 0,
    })
    .returning()

  return plan
}

export async function updatePlan(
  planId: string,
  data: Partial<{
    name: string
    priceCents: number
    trialDays: number | null
    stripePriceId: string | null
    limits: Record<string, number>
    features: Record<string, boolean>
    displayOrder: number
    active: boolean
  }>,
): Promise<Plan> {
  const [updated] = await db
    .update(plans)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(plans.id, planId))
    .returning()

  return updated
}

// ─── SUBSCRIPTION READS ────────────────────────────────────────────

export async function getSubscription(tenantId: string): Promise<SubscriptionWithPlan | null> {
  const result = await db
    .select({
      id: tenantSubscriptions.id,
      tenantId: tenantSubscriptions.tenantId,
      planId: tenantSubscriptions.planId,
      status: tenantSubscriptions.status,
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
      currentPeriodStart: tenantSubscriptions.currentPeriodStart,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      canceledAt: tenantSubscriptions.canceledAt,
      source: tenantSubscriptions.source,
      giftedBy: tenantSubscriptions.giftedBy,
      giftedMonths: tenantSubscriptions.giftedMonths,
      notes: tenantSubscriptions.notes,
      createdAt: tenantSubscriptions.createdAt,
      updatedAt: tenantSubscriptions.updatedAt,
      plan: {
        id: plans.id,
        slug: plans.slug,
        name: plans.name,
        priceCents: plans.priceCents,
        billingInterval: plans.billingInterval,
        trialDays: plans.trialDays,
        stripePriceId: plans.stripePriceId,
        limits: plans.limits,
        features: plans.features,
        displayOrder: plans.displayOrder,
        active: plans.active,
        createdAt: plans.createdAt,
        updatedAt: plans.updatedAt,
      },
    })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  if (!result[0]) return null

  const { plan, ...sub } = result[0]
  return { ...sub, plan } as SubscriptionWithPlan
}

// ─── SUBSCRIPTION WRITES ───────────────────────────────────────────

export async function createSubscription(
  tenantId: string,
  planId: string,
  opts?: {
    trialDays?: number
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    status?: SubscriptionStatus
    source?: string
  }
): Promise<{ subscription: TenantSubscription; created: boolean }> {
  const now = new Date()
  const periodStart = opts?.currentPeriodStart ?? now
  const periodEnd = opts?.currentPeriodEnd ?? addDays(now, opts?.trialDays ?? 14)

  // Idempotent: a tenant can only have one subscription, and multiple flows
  // may try to create it (self-signup, admin approval, admin creation).
  // Keeping the existing row is always the right call — it may already
  // carry Stripe state or an admin-granted plan.
  //
  // `created` tells the caller whether this call actually inserted the row,
  // as opposed to finding one already there. This matters for anything that
  // should fire once per real subscription (e.g. the Discord notifier) — a
  // retried call (or a second flow racing the first) must not re-announce
  // an existing subscription.
  const [inserted] = await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      planId,
      status: opts?.status ?? 'trialing',
      source: opts?.source ?? 'trial',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoNothing({ target: tenantSubscriptions.tenantId })
    .returning()

  if (inserted) return { subscription: inserted, created: true }

  const [existing] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)

  return { subscription: existing, created: false }
}

export async function updateSubscriptionStatus(
  tenantId: string,
  status: SubscriptionStatus,
  opts?: { canceledAt?: Date }
) {
  const setData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  }

  if (opts?.canceledAt) {
    setData.canceledAt = opts.canceledAt
  }

  const [result] = await db
    .update(tenantSubscriptions)
    .set(setData)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .returning()

  return result ?? null
}

export async function updateSubscriptionPlan(
  tenantId: string,
  planId: string,
  source: string,
  opts?: {
    status?: SubscriptionStatus
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
  }
) {
  const setData: Record<string, unknown> = {
    planId,
    source,
    updatedAt: new Date(),
  }

  if (opts?.status) setData.status = opts.status
  if (opts?.stripeCustomerId) setData.stripeCustomerId = opts.stripeCustomerId
  if (opts?.stripeSubscriptionId) setData.stripeSubscriptionId = opts.stripeSubscriptionId
  if (opts?.currentPeriodStart) setData.currentPeriodStart = opts.currentPeriodStart
  if (opts?.currentPeriodEnd) setData.currentPeriodEnd = opts.currentPeriodEnd

  const [result] = await db
    .update(tenantSubscriptions)
    .set(setData)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .returning()

  return result ?? null
}

export async function giftSubscription(
  tenantId: string,
  planId: string,
  months: number,
  giftedBy: string,
  notes?: string
) {
  const now = new Date()
  const periodEnd = addMonths(now, months)

  const [result] = await db
    .update(tenantSubscriptions)
    .set({
      planId,
      status: 'active',
      source: 'gift',
      giftedBy,
      giftedMonths: months,
      notes: notes ?? null,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      stripeSubscriptionId: null,
      canceledAt: null,
      updatedAt: now,
    })
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .returning()

  return result ?? null
}

export async function extendTrial(tenantId: string, days: number) {
  const [result] = await db
    .update(tenantSubscriptions)
    .set({
      currentPeriodEnd: sql`${tenantSubscriptions.currentPeriodEnd} + ${`${days} days`}::interval`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantSubscriptions.tenantId, tenantId),
        eq(tenantSubscriptions.status, 'trialing')
      )
    )
    .returning()

  return result ?? null
}

// ─── ADMIN QUERIES ─────────────────────────────────────────────────

export async function listAllSubscriptions(filters?: {
  status?: SubscriptionStatus
  planSlug?: string
}): Promise<SubscriptionListItem[]> {
  const conditions = []

  if (filters?.status) {
    conditions.push(eq(tenantSubscriptions.status, filters.status))
  }

  if (filters?.planSlug) {
    conditions.push(eq(plans.slug, filters.planSlug))
  }

  const result = await db
    .select({
      id: tenantSubscriptions.id,
      tenantId: tenantSubscriptions.tenantId,
      planId: tenantSubscriptions.planId,
      status: tenantSubscriptions.status,
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
      currentPeriodStart: tenantSubscriptions.currentPeriodStart,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      canceledAt: tenantSubscriptions.canceledAt,
      source: tenantSubscriptions.source,
      giftedBy: tenantSubscriptions.giftedBy,
      giftedMonths: tenantSubscriptions.giftedMonths,
      notes: tenantSubscriptions.notes,
      createdAt: tenantSubscriptions.createdAt,
      updatedAt: tenantSubscriptions.updatedAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      planSlug: plans.slug,
      planName: plans.name,
    })
    .from(tenantSubscriptions)
    .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
    .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(tenantSubscriptions.currentPeriodEnd))

  return result as SubscriptionListItem[]
}

export async function getExpiredTrials(): Promise<TenantSubscription[]> {
  return db
    .select()
    .from(tenantSubscriptions)
    .where(
      and(
        eq(tenantSubscriptions.status, 'trialing'),
        lt(tenantSubscriptions.currentPeriodEnd, new Date())
      )
    )
}

import { db } from '@/db/client'
import {
  auditLogs,
  billingCardFingerprints,
  plans,
  referralCodeAliases,
  referralRewardEvents,
  tenantReferrals,
  tenants,
  tenantSubscriptions,
  tenantUsers,
  users,
} from '@/db/schema'
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, notExists, notInArray, sql } from 'drizzle-orm'
import { isUniqueViolation } from '@/lib/errors'
import { normalizeBrPhone } from '@/lib/phone'
import { canRefer } from '@/lib/referral/config'
import { generateReferralCode } from '@/lib/referral/code'
import {
  MAX_PREVIOUS_REFERRAL_CODES,
  REFERRAL_CODE_CHANGES_PER_DAY,
  REFERRAL_CODE_CHANGE_WINDOW_MS,
} from '@/lib/referral/custom-code'
import type {
  CandidateTenant,
  CapturedVia,
  CardSighting,
  IneligibleReason,
  PausedReason,
  ReferralChecks,
  ReferralState,
  ReferralStatus,
  RewardEventReason,
  TenantSignals,
} from '@/lib/referral/types'
import { rowsFromExecuteResult } from './admin-tenants'

/** Same convention as consent.ts (`tx: typeof db`). Functions that take `exec` default to `db`. */
export type DbExecutor = typeof db
export type TenantReferral = typeof tenantReferrals.$inferSelect
export type ReferralRewardEvent = typeof referralRewardEvents.$inferSelect

const TERMINAL_STATUSES = ['canceled', 'ineligible']
const CODE_RETRIES = 5

// ── codes ──

/**
 * Returns the tenant's code, creating it on first call (up to 5 retries on uq_tenants_referral_code). A generated
 * code that is some tenant's retired code is skipped, so old codes never change hands; the candidate's advisory
 * lock (see lockReferralCodes) keeps a code being retired right now from slipping past that check.
 */
export async function getOrCreateReferralCode(tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    const [existing] = await db
      .select({ code: tenants.referralCode })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    if (existing?.code) return existing.code
    if (!existing) throw new Error(`Tenant ${tenantId} not found`)

    const candidate = generateReferralCode()
    try {
      const stored = await db.transaction(async (tx) => {
        await lockReferralCodes(tx, [candidate])
        const [updated] = await tx
          .update(tenants)
          .set({ referralCode: candidate })
          .where(
            and(
              eq(tenants.id, tenantId),
              isNull(tenants.referralCode),
              notExists(tx.select({ one: sql`1` }).from(referralCodeAliases).where(eq(referralCodeAliases.code, candidate))),
            ),
          )
          .returning({ code: tenants.referralCode })
        return updated?.code ?? null
      })
      if (stored) return stored
      // Lost a race to another writer, or the candidate is a retired code: loop, re-read, try another.
    } catch (err) {
      if (!isUniqueViolation(err, 'uq_tenants_referral_code')) throw err
    }
  }
  throw new Error('Could not generate a unique referral code')
}

/**
 * Transaction advisory locks, one per code, in sorted order (no deadlocks). Every writer of tenants.referral_code
 * or referral_code_aliases takes them, so one code cannot end up both retired by one tenant and current for another.
 */
async function lockReferralCodes(tx: Pick<DbExecutor, 'execute'>, codes: Array<string | null>): Promise<void> {
  for (const code of [...new Set(codes.filter((c): c is string => !!c))].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'referral_code:' + code}))`)
  }
}

/** Audit rows written by updateReferralCode; the rolling change limit counts them. */
export const REFERRAL_CODE_AUDIT_ENTITY = 'referral_code'

/**
 * True when no other tenant holds `code` (already normalised) as its current code or as a retired one. The
 * tenant's own current and retired codes count as available.
 */
export async function isReferralCodeAvailable(tenantId: string, code: string): Promise<boolean> {
  const [current] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.referralCode, code), ne(tenants.id, tenantId)))
    .limit(1)
  if (current) return false
  const [alias] = await db
    .select({ id: referralCodeAliases.tenantId })
    .from(referralCodeAliases)
    .where(and(eq(referralCodeAliases.code, code), ne(referralCodeAliases.tenantId, tenantId)))
    .limit(1)
  return !alias
}

/** The tenant's retired codes, newest first. They all still resolve to the tenant. */
export async function listPreviousReferralCodes(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ code: referralCodeAliases.code })
    .from(referralCodeAliases)
    .where(eq(referralCodeAliases.tenantId, tenantId))
    .orderBy(desc(referralCodeAliases.retiredAt))
  return rows.map((r) => r.code)
}

export type UpdateReferralCodeResult =
  | { outcome: 'updated'; code: string; previousCode: string | null }
  | { outcome: 'unchanged'; code: string }
  | { outcome: 'taken' }
  | { outcome: 'rate_limited' }
  | { outcome: 'alias_limit' }

/**
 * Sets the tenant's referral code to `code` (already validated and normalised). The old code is kept as an alias
 * (referral_code_aliases) that keeps resolving to this tenant; switching back to one of the tenant's own old codes
 * just swaps it back. Once MAX_PREVIOUS_REFERRAL_CODES old codes exist, changes to a brand-new code are refused.
 *
 * Locks the tenant row (so the rolling REFERRAL_CODE_CHANGES_PER_DAY limit holds under concurrent saves) and the
 * old and new codes (lockReferralCodes), so two tenants cannot race one code into both tenants.referral_code and
 * referral_code_aliases. uq_tenants_referral_code and the aliases primary key back both sides; either maps to 'taken'.
 */
export async function updateReferralCode(input: {
  tenantId: string
  userId: string
  code: string
  now?: Date
}): Promise<UpdateReferralCodeResult> {
  const now = input.now ?? new Date()
  try {
    return await db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ code: tenants.referralCode })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .for('update')
      if (!tenant) throw new Error(`Tenant ${input.tenantId} not found`)
      if (tenant.code === input.code) return { outcome: 'unchanged', code: input.code } as const

      await lockReferralCodes(tx, [tenant.code, input.code])

      const [alias] = await tx
        .select({ tenantId: referralCodeAliases.tenantId })
        .from(referralCodeAliases)
        .where(eq(referralCodeAliases.code, input.code))
        .limit(1)
      if (alias && alias.tenantId !== input.tenantId) return { outcome: 'taken' } as const
      const [holder] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.referralCode, input.code), ne(tenants.id, input.tenantId)))
        .limit(1)
      if (holder) return { outcome: 'taken' } as const
      const reclaiming = !!alias

      if (!reclaiming && tenant.code) {
        const [previous] = await tx
          .select({ n: count() })
          .from(referralCodeAliases)
          .where(eq(referralCodeAliases.tenantId, input.tenantId))
        if ((previous?.n ?? 0) >= MAX_PREVIOUS_REFERRAL_CODES) return { outcome: 'alias_limit' } as const
      }

      const [recent] = await tx
        .select({ n: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, input.tenantId),
            eq(auditLogs.entityType, REFERRAL_CODE_AUDIT_ENTITY),
            eq(auditLogs.action, 'update'),
            gt(auditLogs.createdAt, new Date(now.getTime() - REFERRAL_CODE_CHANGE_WINDOW_MS)),
          ),
        )
      if ((recent?.n ?? 0) >= REFERRAL_CODE_CHANGES_PER_DAY) return { outcome: 'rate_limited' } as const

      if (reclaiming) await tx.delete(referralCodeAliases).where(eq(referralCodeAliases.code, input.code))
      if (tenant.code) {
        await tx.insert(referralCodeAliases).values({ code: tenant.code, tenantId: input.tenantId, retiredAt: now })
      }
      await tx.update(tenants).set({ referralCode: input.code }).where(eq(tenants.id, input.tenantId))
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'update',
        entityType: REFERRAL_CODE_AUDIT_ENTITY,
        entityId: input.tenantId,
        changes: { referralCode: { old: tenant.code, new: input.code } },
        createdAt: now,
      })
      return { outcome: 'updated', code: input.code, previousCode: tenant.code } as const
    })
  } catch (err) {
    // The unique violation aborted the transaction; it is rolled back by the time we get here.
    if (isUniqueViolation(err, 'uq_tenants_referral_code') || isUniqueViolation(err, 'referral_code_aliases_pkey')) {
      return { outcome: 'taken' }
    }
    throw err
  }
}

/**
 * By normalised code, current or retired (an old code resolves to the tenant that used it). The current code wins.
 * canRefer = config.canRefer(row) && tenant not deleted. Null when no tenant has or had the code.
 * Two primary/unique-index lookups rather than one OR, which Postgres would answer with a scan of tenants.
 */
export async function findReferrerByCode(
  code: string,
): Promise<{ tenantId: string; name: string; canRefer: boolean } | null> {
  const referrer = (where: ReturnType<typeof eq>) =>
    db
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        deletedAt: tenants.deletedAt,
        source: tenantSubscriptions.source,
        status: tenantSubscriptions.status,
      })
      .from(tenants)
      .leftJoin(tenantSubscriptions, eq(tenantSubscriptions.tenantId, tenants.id))
      .where(where)
      .limit(1)

  let [row] = await referrer(eq(tenants.referralCode, code))
  if (!row) {
    const [alias] = await db
      .select({ tenantId: referralCodeAliases.tenantId })
      .from(referralCodeAliases)
      .where(eq(referralCodeAliases.code, code))
      .limit(1)
    if (alias) [row] = await referrer(eq(tenants.id, alias.tenantId))
  }
  if (!row) return null
  const sub = row.source === null || row.status === null ? null : { source: row.source, status: row.status }
  return { tenantId: row.tenantId, name: row.name, canRefer: row.deletedAt === null && canRefer(sub) }
}

// ── referral rows ──

export async function getReferralById(id: string): Promise<TenantReferral | null> {
  const [row] = await db.select().from(tenantReferrals).where(eq(tenantReferrals.id, id)).limit(1)
  return row ?? null
}

/** For reward emails: referred clinic name, even when that tenant is deleted. */
export async function getReferralSummary(
  id: string,
): Promise<{ id: string; referredName: string; status: ReferralStatus } | null> {
  const [row] = await db
    .select({ id: tenantReferrals.id, referredName: tenants.name, status: tenantReferrals.status })
    .from(tenantReferrals)
    .innerJoin(tenants, eq(tenants.id, tenantReferrals.referredTenantId))
    .where(eq(tenantReferrals.id, id))
    .limit(1)
  return row ? { ...row, status: row.status as ReferralStatus } : null
}

/** Tenant id → clinic name, deleted tenants included. */
export async function getTenantNames(ids: string[]): Promise<Record<string, string>> {
  const rows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.id, ids))
  return Object.fromEntries(rows.map((row) => [row.id, row.name]))
}

export async function getReferralByReferredTenant(referredTenantId: string): Promise<TenantReferral | null> {
  const [row] = await db
    .select()
    .from(tenantReferrals)
    .where(eq(tenantReferrals.referredTenantId, referredTenantId))
    .limit(1)
  return row ?? null
}

export async function findReferralByStripeSubscription(stripeSubscriptionId: string): Promise<TenantReferral | null> {
  const [row] = await db
    .select()
    .from(tenantReferrals)
    .where(eq(tenantReferrals.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)
  return row ?? null
}

/** INSERT … ON CONFLICT (referred_tenant_id) DO NOTHING RETURNING *; null when one already existed. */
export async function insertReferral(input: {
  referrerTenantId: string
  referredTenantId: string
  code: string
  capturedVia: CapturedVia
  capturedAt: Date
  status: 'trial' | 'ineligible'
  ineligibleReason: IneligibleReason | null
  checks: ReferralChecks
}): Promise<TenantReferral | null> {
  const [row] = await db
    .insert(tenantReferrals)
    .values({
      referrerTenantId: input.referrerTenantId,
      referredTenantId: input.referredTenantId,
      code: input.code,
      capturedVia: input.capturedVia,
      capturedAt: input.capturedAt,
      status: input.status,
      ineligibleReason: input.ineligibleReason,
      checks: input.checks as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: tenantReferrals.referredTenantId })
    .returning()
  return row ?? null
}

function mergeChecks(checks: ReferralChecks | undefined) {
  return checks && Object.keys(checks).length > 0
    ? { checks: sql`${tenantReferrals.checks} || ${JSON.stringify(checks)}::jsonb` }
    : {}
}

/** Optimistic write: bumps `version`, applies only if `version` still equals `expectedVersion`. `checks` is merged (jsonb ||). */
export async function updateReferralState(
  id: string,
  expectedVersion: number,
  next: ReferralState,
  checks?: ReferralChecks,
): Promise<boolean> {
  const rows = await db
    .update(tenantReferrals)
    .set({
      status: next.status,
      pausedReason: next.pausedReason,
      ineligibleReason: next.ineligibleReason,
      stripeSubscriptionId: next.stripeSubscriptionId,
      firstPaidAt: next.firstPaidAt,
      qualifiedAt: next.qualifiedAt,
      qualifyingInvoiceId: next.qualifyingInvoiceId,
      endedAt: next.endedAt,
      ...mergeChecks(checks),
      version: sql`${tenantReferrals.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tenantReferrals.id, id), eq(tenantReferrals.version, expectedVersion)))
    .returning({ id: tenantReferrals.id })
  return rows.length > 0
}

/** Sets ineligible/<reason> from any non-ineligible status (bumps version); merges `checks`; returns the updated row or null. */
export async function markReferralIneligible(
  id: string,
  reason: IneligibleReason,
  note?: string,
  checks?: ReferralChecks,
): Promise<TenantReferral | null> {
  const patch: ReferralChecks = { ...checks, ...(note ? { adminNote: note } : {}) }
  const [row] = await db
    .update(tenantReferrals)
    .set({
      status: 'ineligible',
      ineligibleReason: reason,
      pausedReason: null,
      endedAt: sql`coalesce(${tenantReferrals.endedAt}, now())`,
      ...mergeChecks(patch),
      version: sql`${tenantReferrals.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tenantReferrals.id, id), sql`${tenantReferrals.status} <> 'ineligible'`))
    .returning()
  return row ?? null
}

/** Sets stripe_subscription_id only while it is null. Returns the bound id afterwards (the existing one when already bound). */
export async function bindReferralSubscription(id: string, stripeSubscriptionId: string): Promise<string | null> {
  const [bound] = await db
    .update(tenantReferrals)
    .set({
      stripeSubscriptionId,
      version: sql`${tenantReferrals.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tenantReferrals.id, id), isNull(tenantReferrals.stripeSubscriptionId)))
    .returning({ stripeSubscriptionId: tenantReferrals.stripeSubscriptionId })
  if (bound) return bound.stripeSubscriptionId
  const [existing] = await db
    .select({ stripeSubscriptionId: tenantReferrals.stripeSubscriptionId })
    .from(tenantReferrals)
    .where(eq(tenantReferrals.id, id))
    .limit(1)
  return existing?.stripeSubscriptionId ?? null
}

// ── snapshot inputs for refreshReferral ──

export interface ReferralContext {
  referral: TenantReferral
  referredDeleted: boolean
  referredSignupAt: Date // tenants.created_at
  // referredSub.stripeSubscriptionId is for localTrialEnded only; it is NEVER used as the referral's subscription
  referredSub: null | {
    source: string
    status: string
    stripeSubscriptionId: string | null
    stripeCustomerId: string | null
    currentPeriodEnd: Date
  }
  referrerCustomerId: string | null // referrer's tenant_subscriptions.stripe_customer_id
}

export async function getReferralContext(referralId: string): Promise<ReferralContext | null> {
  const referral = await getReferralById(referralId)
  if (!referral) return null

  const [referred] = await db
    .select({ createdAt: tenants.createdAt, deletedAt: tenants.deletedAt })
    .from(tenants)
    .where(eq(tenants.id, referral.referredTenantId))
    .limit(1)
  if (!referred) return null

  const [referredSub] = await db
    .select({
      source: tenantSubscriptions.source,
      status: tenantSubscriptions.status,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
    })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, referral.referredTenantId))
    .limit(1)

  const [referrerSub] = await db
    .select({ stripeCustomerId: tenantSubscriptions.stripeCustomerId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, referral.referrerTenantId))
    .limit(1)

  return {
    referral,
    referredDeleted: referred.deletedAt !== null,
    referredSignupAt: referred.createdAt,
    referredSub: referredSub ?? null,
    referrerCustomerId: referrerSub?.stripeCustomerId ?? null,
  }
}

// ── signals ──

function safePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const normalized = normalizeBrPhone(raw)
    return normalized === '' ? null : normalized
  } catch {
    return null
  }
}

function registryKey(u: { type: string | null; number: string | null; state: string | null }): string | null {
  const type = u.type?.trim().toUpperCase()
  const number = u.number?.replace(/\D/g, '')
  const state = u.state?.trim().toUpperCase()
  return type && number && state ? `${type}:${number}:${state}` : null
}

async function loadSignalsForTenants(tenantIds: string[]): Promise<Map<string, TenantSignals>> {
  const result = new Map<string, TenantSignals>()
  if (tenantIds.length === 0) return result
  for (const tenantId of tenantIds) {
    result.set(tenantId, { tenantId, ownerEmails: [], phones: [], registries: [], userIds: [], cardFingerprints: [] })
  }

  const [tenantRows, memberRows, cardRows] = await Promise.all([
    db.select({ id: tenants.id, phone: tenants.phone }).from(tenants).where(inArray(tenants.id, tenantIds)),
    db
      .select({
        tenantId: tenantUsers.tenantId,
        userId: tenantUsers.userId,
        role: tenantUsers.role,
        isActive: tenantUsers.isActive,
        email: users.email,
        phone: users.phone,
        registryType: users.registryType,
        registryNumber: users.registryNumber,
        registryState: users.registryState,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(inArray(tenantUsers.tenantId, tenantIds)),
    db
      .select({ tenantId: billingCardFingerprints.tenantId, fingerprint: billingCardFingerprints.fingerprint })
      .from(billingCardFingerprints)
      .where(inArray(billingCardFingerprints.tenantId, tenantIds)),
  ])

  const sets = new Map<string, { emails: Set<string>; phones: Set<string>; registries: Set<string>; userIds: Set<string>; cards: Set<string> }>()
  for (const id of tenantIds) {
    sets.set(id, { emails: new Set(), phones: new Set(), registries: new Set(), userIds: new Set(), cards: new Set() })
  }

  for (const t of tenantRows) {
    const phone = safePhone(t.phone)
    if (phone) sets.get(t.id)?.phones.add(phone)
  }
  for (const m of memberRows) {
    const s = sets.get(m.tenantId)
    if (!s) continue
    s.userIds.add(m.userId)
    if (m.role === 'owner') {
      const email = m.email.trim().toLowerCase()
      if (email) s.emails.add(email)
      const phone = safePhone(m.phone)
      if (phone) s.phones.add(phone)
    }
    if (m.isActive) {
      const key = registryKey({ type: m.registryType, number: m.registryNumber, state: m.registryState })
      if (key) s.registries.add(key)
    }
  }
  for (const c of cardRows) sets.get(c.tenantId)?.cards.add(c.fingerprint)

  for (const [tenantId, s] of sets) {
    result.set(tenantId, {
      tenantId,
      ownerEmails: [...s.emails],
      phones: [...s.phones],
      registries: [...s.registries],
      userIds: [...s.userIds],
      cardFingerprints: [...s.cards],
    })
  }
  return result
}

export async function loadTenantSignals(tenantId: string): Promise<TenantSignals> {
  const map = await loadSignalsForTenants([tenantId])
  return map.get(tenantId)!
}

const DIGITS_RIGHT_8 = (column: unknown) => sql<string>`right(regexp_replace(${column}, '\\D', '', 'g'), 8)`

/**
 * Pre-filter in SQL by any owner_email / phone / registry / fingerprint / user overlap (phones compare on the
 * last 8 digits, so the filter over-selects and the caller's exact matching decides), then load full signals,
 * the subscription window and card sightings for those tenants (deleted included).
 */
export async function loadCandidateTenants(
  referred: TenantSignals,
  excludeTenantIds: string[],
): Promise<CandidateTenant[]> {
  const ids = new Set<string>()
  const add = (rows: Array<{ tenantId: string }>) => rows.forEach((r) => ids.add(r.tenantId))
  const phoneTails = [...new Set(referred.phones.map((p) => p.slice(-8)).filter((p) => p.length === 8))]

  const lookups: Array<Promise<void>> = []
  if (referred.ownerEmails.length > 0) {
    lookups.push(
      db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.role, 'owner'), inArray(sql`lower(${users.email})`, referred.ownerEmails)))
        .then(add),
    )
  }
  if (phoneTails.length > 0) {
    lookups.push(
      db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.role, 'owner'), inArray(DIGITS_RIGHT_8(users.phone), phoneTails)))
        .then(add),
      db
        .select({ tenantId: tenants.id })
        .from(tenants)
        .where(inArray(DIGITS_RIGHT_8(tenants.phone), phoneTails))
        .then(add),
    )
  }
  if (referred.registries.length > 0) {
    lookups.push(
      db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(
          and(
            eq(tenantUsers.isActive, true),
            inArray(
              sql`upper(trim(${users.registryType})) || ':' || regexp_replace(${users.registryNumber}, '\\D', '', 'g') || ':' || upper(trim(${users.registryState}))`,
              referred.registries,
            ),
          ),
        )
        .then(add),
    )
  }
  if (referred.cardFingerprints.length > 0) {
    lookups.push(
      db
        .select({ tenantId: billingCardFingerprints.tenantId })
        .from(billingCardFingerprints)
        .where(inArray(billingCardFingerprints.fingerprint, referred.cardFingerprints))
        .then(add),
    )
  }
  if (referred.userIds.length > 0) {
    lookups.push(
      db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .where(inArray(tenantUsers.userId, referred.userIds))
        .then(add),
    )
  }
  await Promise.all(lookups)

  const excluded = new Set([referred.tenantId, ...excludeTenantIds])
  const candidateIds = [...ids].filter((id) => !excluded.has(id))
  if (candidateIds.length === 0) return []

  const [signals, subs, cardRows] = await Promise.all([
    loadSignalsForTenants(candidateIds),
    db
      .select({
        tenantId: tenantSubscriptions.tenantId,
        createdAt: tenantSubscriptions.createdAt,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      })
      .from(tenantSubscriptions)
      .where(inArray(tenantSubscriptions.tenantId, candidateIds)),
    db.select().from(billingCardFingerprints).where(inArray(billingCardFingerprints.tenantId, candidateIds)),
  ])

  const candidates: CandidateTenant[] = []
  for (const sub of subs) {
    const base = signals.get(sub.tenantId)
    if (!base) continue
    candidates.push({
      ...base,
      subscriptionCreatedAt: sub.createdAt,
      subscriptionEndsAt: sub.currentPeriodEnd,
      cards: cardRows
        .filter((c) => c.tenantId === sub.tenantId)
        .map((c) => ({ fingerprint: c.fingerprint, firstSeenAt: c.firstSeenAt, lastSeenAt: c.lastSeenAt })),
    })
  }
  return candidates
}

/** Upsert: ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET first_seen_at = LEAST(…), last_seen_at = GREATEST(…). */
export async function recordCardFingerprints(tenantId: string, sightings: CardSighting[]): Promise<void> {
  // One statement cannot touch the same conflict target twice, so fold duplicates first.
  const merged = new Map<string, CardSighting>()
  for (const s of sightings) {
    const prev = merged.get(s.fingerprint)
    merged.set(
      s.fingerprint,
      prev
        ? {
            fingerprint: s.fingerprint,
            firstSeenAt: s.firstSeenAt < prev.firstSeenAt ? s.firstSeenAt : prev.firstSeenAt,
            lastSeenAt: s.lastSeenAt > prev.lastSeenAt ? s.lastSeenAt : prev.lastSeenAt,
          }
        : s,
    )
  }
  if (merged.size === 0) return

  await db
    .insert(billingCardFingerprints)
    .values([...merged.values()].map((s) => ({ tenantId, ...s })))
    .onConflictDoUpdate({
      target: [billingCardFingerprints.tenantId, billingCardFingerprints.fingerprint],
      set: {
        firstSeenAt: sql`LEAST(${billingCardFingerprints.firstSeenAt}, excluded.first_seen_at)`,
        lastSeenAt: sql`GREATEST(${billingCardFingerprints.lastSeenAt}, excluded.last_seen_at)`,
      },
    })
}

// ── reward inputs ──

export interface ReferrerBilling {
  tenantId: string
  source: string
  status: string
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
  currentPeriodEnd: Date
  planId: string
  billingInterval: string
  priceCents: number
  whatsappLimit: number
}

export async function getReferrerBilling(tenantId: string, exec: DbExecutor = db): Promise<ReferrerBilling | null> {
  const [row] = await exec
    .select({
      tenantId: tenantSubscriptions.tenantId,
      source: tenantSubscriptions.source,
      status: tenantSubscriptions.status,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      planId: tenantSubscriptions.planId,
      billingInterval: plans.billingInterval,
      priceCents: plans.priceCents,
      limits: plans.limits,
    })
    .from(tenantSubscriptions)
    .innerJoin(plans, eq(plans.id, tenantSubscriptions.planId))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1)
  if (!row) return null
  const { limits, ...rest } = row
  const credits = (limits as { whatsapp_credits?: unknown } | null)?.whatsapp_credits
  return { ...rest, whatsappLimit: typeof credits === 'number' ? credits : 0 }
}

/** count(status='counting') of the referrer's referrals. */
export async function countCountingReferrals(referrerTenantId: string, exec: DbExecutor = db): Promise<number> {
  const [row] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantReferrals)
    .where(and(eq(tenantReferrals.referrerTenantId, referrerTenantId), eq(tenantReferrals.status, 'counting')))
  return row?.count ?? 0
}

/** Has ≥1 referral row (any status) or ≥1 reward event. */
export async function isReferrer(tenantId: string): Promise<boolean> {
  const [referral] = await db
    .select({ id: tenantReferrals.id })
    .from(tenantReferrals)
    .where(eq(tenantReferrals.referrerTenantId, tenantId))
    .limit(1)
  if (referral) return true
  const [event] = await db
    .select({ id: referralRewardEvents.id })
    .from(referralRewardEvents)
    .where(eq(referralRewardEvents.referrerTenantId, tenantId))
    .limit(1)
  return Boolean(event)
}

/**
 * One transaction holding a per-referrer advisory lock; lock_timeout makes a stuck holder throw instead of
 * hanging the webhook. `fn` must do ALL its DB access through `tx` (one pooled connection per sync).
 */
export async function withReferrerRewardLock<T>(
  referrerTenantId: string,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral_reward:${referrerTenantId}`}::text))`)
    return fn(tx as unknown as DbExecutor)
  })
}

/**
 * Called inside withReferrerRewardLock with its tx (no lock of its own): read the latest event, insert only if
 * (counting, discountPercent, bonusCredits, stripeSubscriptionId) differs. Returns the previous row.
 */
export async function recordRewardStateIfChanged(
  input: {
    referrerTenantId: string
    counting: number
    discountPercent: number
    bonusCredits: number
    stripeSubscriptionId: string | null
    reason: RewardEventReason
    referralId: string | null
  },
  exec: DbExecutor,
): Promise<{ inserted: boolean; previous: ReferralRewardEvent | null }> {
  const [previous] = await exec
    .select()
    .from(referralRewardEvents)
    .where(eq(referralRewardEvents.referrerTenantId, input.referrerTenantId))
    .orderBy(desc(referralRewardEvents.createdAt), desc(referralRewardEvents.id))
    .limit(1)

  if (
    previous &&
    previous.counting === input.counting &&
    previous.discountPercent === input.discountPercent &&
    previous.bonusCredits === input.bonusCredits &&
    previous.stripeSubscriptionId === input.stripeSubscriptionId
  ) {
    return { inserted: false, previous }
  }

  await exec.insert(referralRewardEvents).values({
    referrerTenantId: input.referrerTenantId,
    counting: input.counting,
    discountPercent: input.discountPercent,
    bonusCredits: input.bonusCredits,
    stripeSubscriptionId: input.stripeSubscriptionId,
    reason: input.reason,
    referralId: input.referralId,
    // transaction start time (the default) can predate an earlier lock holder's row; wall-clock keeps "latest" correct
    createdAt: sql`clock_timestamp()`,
  })
  return { inserted: true, previous: previous ?? null }
}

/** Newest first. */
export async function listRewardEvents(referrerTenantId: string, limit = 10): Promise<ReferralRewardEvent[]> {
  return db
    .select()
    .from(referralRewardEvents)
    .where(eq(referralRewardEvents.referrerTenantId, referrerTenantId))
    .orderBy(desc(referralRewardEvents.createdAt), desc(referralRewardEvents.id))
    .limit(limit)
}

// ── dashboard / admin ──

/** Newest first; referred tenant name even if deleted. */
export async function listReferralsForReferrer(referrerTenantId: string): Promise<
  Array<{
    id: string
    referredName: string
    capturedAt: Date
    status: ReferralStatus
    pausedReason: PausedReason | null
    ineligibleReason: IneligibleReason | null
  }>
> {
  const rows = await db
    .select({
      id: tenantReferrals.id,
      referredName: tenants.name,
      capturedAt: tenantReferrals.capturedAt,
      status: tenantReferrals.status,
      pausedReason: tenantReferrals.pausedReason,
      ineligibleReason: tenantReferrals.ineligibleReason,
    })
    .from(tenantReferrals)
    .innerJoin(tenants, eq(tenants.id, tenantReferrals.referredTenantId))
    .where(eq(tenantReferrals.referrerTenantId, referrerTenantId))
    .orderBy(desc(tenantReferrals.capturedAt))
  return rows.map((r) => ({
    ...r,
    status: r.status as ReferralStatus,
    pausedReason: r.pausedReason as PausedReason | null,
    ineligibleReason: r.ineligibleReason as IneligibleReason | null,
  }))
}

export async function getReferralAttribution(referredTenantId: string): Promise<{
  id: string
  status: ReferralStatus
  stripeSubscriptionId: string | null
  referrerTenantId: string
  referrerName: string
} | null> {
  const [row] = await db
    .select({
      id: tenantReferrals.id,
      status: tenantReferrals.status,
      stripeSubscriptionId: tenantReferrals.stripeSubscriptionId,
      referrerTenantId: tenantReferrals.referrerTenantId,
      referrerName: tenants.name,
    })
    .from(tenantReferrals)
    .innerJoin(tenants, eq(tenants.id, tenantReferrals.referrerTenantId))
    .where(eq(tenantReferrals.referredTenantId, referredTenantId))
    .limit(1)
  return row ? { ...row, status: row.status as ReferralStatus } : null
}

export async function getTenantReferralAdminView(tenantId: string): Promise<{
  code: string | null
  referredBy: (TenantReferral & { referrerName: string }) | null
  referrals: Array<TenantReferral & { referredName: string }>
  events: ReferralRewardEvent[]
}> {
  const [tenant] = await db
    .select({ code: tenants.referralCode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const [referredByRow] = await db
    .select({ referral: tenantReferrals, referrerName: tenants.name })
    .from(tenantReferrals)
    .innerJoin(tenants, eq(tenants.id, tenantReferrals.referrerTenantId))
    .where(eq(tenantReferrals.referredTenantId, tenantId))
    .limit(1)

  const referralRows = await db
    .select({ referral: tenantReferrals, referredName: tenants.name })
    .from(tenantReferrals)
    .innerJoin(tenants, eq(tenants.id, tenantReferrals.referredTenantId))
    .where(eq(tenantReferrals.referrerTenantId, tenantId))
    .orderBy(desc(tenantReferrals.capturedAt))

  return {
    code: tenant?.code ?? null,
    referredBy: referredByRow ? { ...referredByRow.referral, referrerName: referredByRow.referrerName } : null,
    referrals: referralRows.map((r) => ({ ...r.referral, referredName: r.referredName })),
    events: await listRewardEvents(tenantId),
  }
}

// ── reconcile / webhook lookups ──

/**
 * One unit per referrer: referrers with a non-terminal referral (referralIds = those referrals), plus
 * referrers whose latest event has discount_percent > 0 or bonus_credits > 0 (referralIds may be []).
 * Never-reconciled units (any referral with null reconciled_at, and event-only units) come first, then the
 * least recently reconciled, then referrer id. Within a unit, referrals also run least recently reconciled
 * first, so a run cut mid-unit resumes with the ones it did not reach.
 */
export async function listReconcileUnits(): Promise<Array<{ referrerTenantId: string; referralIds: string[] }>> {
  const referralRows = await db
    .select({
      id: tenantReferrals.id,
      referrerTenantId: tenantReferrals.referrerTenantId,
      reconciledAt: tenantReferrals.reconciledAt,
    })
    .from(tenantReferrals)
    .where(notInArray(tenantReferrals.status, TERMINAL_STATUSES))
    .orderBy(sql`${tenantReferrals.reconciledAt} asc nulls first`, tenantReferrals.id)

  const eventRows = rowsFromExecuteResult<{ referrer_tenant_id: string }>(
    await db.execute(sql`
      select referrer_tenant_id from (
        select distinct on (referrer_tenant_id) referrer_tenant_id, discount_percent, bonus_credits
        from floraclin.referral_reward_events
        order by referrer_tenant_id, created_at desc, id desc
      ) latest
      where discount_percent > 0 or bonus_credits > 0
    `),
  )

  const units = new Map<string, { referralIds: string[]; oldest: number | null }>()
  for (const r of referralRows) {
    const unit = units.get(r.referrerTenantId) ?? { referralIds: [], oldest: Number.POSITIVE_INFINITY as number | null }
    unit.referralIds.push(r.id)
    if (r.reconciledAt === null) unit.oldest = null
    else if (unit.oldest !== null) unit.oldest = Math.min(unit.oldest, r.reconciledAt.getTime())
    units.set(r.referrerTenantId, unit)
  }
  for (const e of eventRows) {
    if (!units.has(e.referrer_tenant_id)) units.set(e.referrer_tenant_id, { referralIds: [], oldest: null })
  }

  return [...units.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a.oldest !== b.oldest) {
        if (a.oldest === null) return -1
        if (b.oldest === null) return 1
        return a.oldest - b.oldest
      }
      return idA < idB ? -1 : idA > idB ? 1 : 0
    })
    .map(([referrerTenantId, unit]) => ({ referrerTenantId, referralIds: unit.referralIds }))
}

/** Does NOT bump version (not a state write). */
export async function markReferralsReconciled(ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return
  await db.update(tenantReferrals).set({ reconciledAt: at }).where(inArray(tenantReferrals.id, ids))
}

export async function getTenantIdByStripeCustomer(customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantSubscriptions.tenantId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.stripeCustomerId, customerId))
    .limit(1)
  return row?.tenantId ?? null
}

export async function getTenantIdByStripeSubscription(subscriptionId: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantSubscriptions.tenantId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1)
  return row?.tenantId ?? null
}

export async function getOwnerContact(
  tenantId: string,
): Promise<{ email: string; ownerName: string; clinicName: string } | null> {
  const [row] = await db
    .select({ email: users.email, ownerName: users.fullName, clinicName: tenants.name })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.role, 'owner'),
        eq(tenantUsers.isActive, true),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(tenantUsers.createdAt))
    .limit(1)
  return row ?? null
}

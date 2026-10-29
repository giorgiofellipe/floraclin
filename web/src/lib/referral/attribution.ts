import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import {
  findReferrerByCode,
  getReferralByReferredTenant,
  getTenantNames,
  insertReferral,
  loadCandidateTenants,
  loadTenantSignals,
} from '@/db/queries/referrals'
import { notifyDiscord } from '@/lib/discord'
import { reportSideEffectFailure } from '@/lib/observability'
import { isReferralEnrollmentEnabled } from './config'
import { runEligibilityChecks } from './eligibility'
import { normalizeReferralCode } from './rules'
import type { CapturedVia } from './types'

export interface AttributionDeps {
  now(): Date
  env: Record<string, string | undefined>
  findReferrer: typeof findReferrerByCode
  existing: typeof getReferralByReferredTenant
  signupAt(tenantId: string): Promise<Date>
  loadSignals: typeof loadTenantSignals
  loadCandidates: typeof loadCandidateTenants
  runChecks: typeof runEligibilityChecks
  insert: typeof insertReferral
  tenantNames: typeof getTenantNames
  notifyDiscord: typeof notifyDiscord
  report: typeof reportSideEffectFailure
}

export type AttributionResult =
  | { outcome: 'created'; referralId: string; status: 'trial' | 'ineligible' }
  | {
      outcome: 'skipped'
      reason: 'disabled' | 'no_code' | 'invalid_code' | 'unknown_or_inactive' | 'already_attributed' | 'same_tenant'
    }

async function tenantSignupAt(tenantId: string): Promise<Date> {
  const [row] = await db.select({ createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!row) throw new Error('Tenant not found for referral attribution')
  return row.createdAt
}

const defaultDeps: AttributionDeps = {
  now: () => new Date(),
  env: process.env,
  findReferrer: findReferrerByCode,
  existing: getReferralByReferredTenant,
  signupAt: tenantSignupAt,
  loadSignals: loadTenantSignals,
  loadCandidates: loadCandidateTenants,
  runChecks: runEligibilityChecks,
  insert: insertReferral,
  tenantNames: getTenantNames,
  notifyDiscord,
  report: reportSideEffectFailure,
}

/**
 * Links a clinic to the referrer who owns `rawCode`, and snapshots the identity checks.
 * Never throws for rule reasons; callers still wrap it, because attribution must never block signup.
 */
export async function attributeReferral(
  input: { referredTenantId: string; rawCode: unknown; capturedVia: CapturedVia },
  overrides: Partial<AttributionDeps> = {},
): Promise<AttributionResult> {
  const deps = { ...defaultDeps, ...overrides }

  if (!isReferralEnrollmentEnabled(deps.env, deps.now())) return { outcome: 'skipped', reason: 'disabled' }

  if (input.rawCode === null || input.rawCode === undefined || input.rawCode === '') {
    return { outcome: 'skipped', reason: 'no_code' }
  }
  const code = normalizeReferralCode(input.rawCode)
  if (!code) return { outcome: 'skipped', reason: 'invalid_code' }

  const referrer = await deps.findReferrer(code)
  if (!referrer || !referrer.canRefer) return { outcome: 'skipped', reason: 'unknown_or_inactive' }
  if (referrer.tenantId === input.referredTenantId) return { outcome: 'skipped', reason: 'same_tenant' }

  if (await deps.existing(input.referredTenantId)) return { outcome: 'skipped', reason: 'already_attributed' }

  const res = await deps.runChecks(
    {
      referredTenantId: input.referredTenantId,
      referrerTenantId: referrer.tenantId,
      referredSignupAt: await deps.signupAt(input.referredTenantId),
      stage: 'attribution',
    },
    { loadSignals: deps.loadSignals, loadCandidates: deps.loadCandidates },
  )

  const row = await deps.insert({
    referrerTenantId: referrer.tenantId,
    referredTenantId: input.referredTenantId,
    code,
    capturedVia: input.capturedVia,
    capturedAt: deps.now(),
    status: res.verdict ? 'ineligible' : 'trial',
    ineligibleReason: res.verdict,
    checks: { atSignup: { selfReferral: res.selfReferral, notNew: res.notNew } },
  })
  if (!row) return { outcome: 'skipped', reason: 'already_attributed' }

  try {
    const names = await deps.tenantNames([input.referredTenantId])
    await deps.notifyDiscord({
      kind: 'referral.attributed',
      referrerName: referrer.name,
      referrerTenantId: referrer.tenantId,
      referredName: names[input.referredTenantId] ?? input.referredTenantId,
      referredTenantId: input.referredTenantId,
      code,
      capturedVia: input.capturedVia,
      ineligibleReason: res.verdict,
    })
  } catch (err) {
    deps.report(err, { area: 'referral', step: 'discord_attributed', extra: { referralId: row.id } })
  }

  return { outcome: 'created', referralId: row.id, status: res.verdict ? 'ineligible' : 'trial' }
}

/**
 * The typed field wins over the cookie. A malformed field does not fall back to the cookie. A field equal to the
 * link cookie counts as 'link' (the form pre-fills it); without the cookie the field always counts as 'signup_field'.
 */
export function pickSignupCode(input: { field: unknown; cookie: unknown }): { code: string; via: CapturedVia } | null {
  const fromCookie = normalizeReferralCode(input.cookie)
  // The field is only in the form when shown, and a link pre-fills it: emptied on purpose means no referral.
  if (typeof input.field === 'string') {
    const typed = input.field.trim()
    if (!typed) return null
    const code = normalizeReferralCode(typed)
    if (!code) return null
    // The form pre-fills the field from ?ref or the cookie; a field still matching the cookie came through the link.
    return { code, via: code === fromCookie ? 'link' : 'signup_field' }
  }
  return fromCookie ? { code: fromCookie, via: 'link' } : null
}

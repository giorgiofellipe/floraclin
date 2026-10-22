// Source of truth for the referral program rules. site/src/lib/referral-rules.ts mirrors everything below the marker;
// a site test fails on drift. Edit here, then copy the shared body over.
// ── shared body ──
export const REFERRAL_PERCENT_PER_REFERRAL = 20
export const REFERRAL_MAX_COUNTING_FOR_DISCOUNT = 5 // 5 × 20% = grátis
export const REFERRAL_BONUS_CREDITS_PER_EXTRA = 100 // per counting referral past 5, per BRT month
export const REFERRAL_WELCOME_PERCENT = 20
export const REFERRAL_WELCOME_MONTHS = 2
export const REFERRAL_TRIAL_DAYS = 14
export const REFERRAL_NEW_CLINIC_WINDOW_MONTHS = 6
export const REFERRAL_END_NOTICE_DAYS = 30
export const REFERRAL_COOKIE_NAME = 'floraclin_ref'
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 60
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const REFERRAL_CODE_LENGTH = 6 // generated codes
export const REFERRAL_CODE_MIN_LENGTH = 4 // any code, generated or chosen by the clinic
export const REFERRAL_CODE_MAX_LENGTH = 12 // tenants.referral_code is varchar(12)
export const REFERRAL_SITE_ORIGIN = 'https://floraclin.com.br'

export type ReferralPercent = 0 | 20 | 40 | 60 | 80 | 100

function clampCounting(counting: number): number {
  return Number.isFinite(counting) ? Math.max(0, Math.floor(counting)) : 0
}

/** 20 × min(counting, 5). Negative / non-integer input is floored at 0. */
export function referralDiscountPercent(counting: number): ReferralPercent {
  const capped = Math.min(clampCounting(counting), REFERRAL_MAX_COUNTING_FOR_DISCOUNT)
  return (capped * REFERRAL_PERCENT_PER_REFERRAL) as ReferralPercent
}

/** 100 × max(counting − 5, 0); 0 when the plan's credit limit is -1 (unlimited). */
export function referralBonusCredits(counting: number, planCreditLimit: number): number {
  if (planCreditLimit === -1) return 0
  return Math.max(clampCounting(counting) - REFERRAL_MAX_COUNTING_FOR_DISCOUNT, 0) * REFERRAL_BONUS_CREDITS_PER_EXTRA
}

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]+$/

/**
 * Trim + uppercase; null unless 4–12 chars of A–Z / 0–9. Wider than REFERRAL_CODE_ALPHABET on purpose:
 * generated codes skip look-alike characters, but a clinic may choose any letters (DRAMICAELA).
 * Codes are stored uppercase, so every lookup through here is case-insensitive.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  if (code.length < REFERRAL_CODE_MIN_LENGTH || code.length > REFERRAL_CODE_MAX_LENGTH) return null
  return REFERRAL_CODE_PATTERN.test(code) ? code : null
}

/** Trim, collapse whitespace; past `max`, cut at the last word boundary and add an ellipsis (hard cut without one). */
export function shortClinicName(name: string, max = 40): string {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const head = clean.slice(0, max - 1)
  const boundary = head.lastIndexOf(' ')
  return `${(boundary > 0 ? head.slice(0, boundary) : head).trimEnd()}…`
}

/** Rows 1..5 for the public table: [{ counting: 1, percent: 20 }, …, { counting: 5, percent: 100 }]. */
export function referralDiscountTable(): Array<{ counting: number; percent: ReferralPercent }> {
  return Array.from({ length: REFERRAL_MAX_COUNTING_FOR_DISCOUNT }, (_, i) => ({
    counting: i + 1,
    percent: referralDiscountPercent(i + 1),
  }))
}

/** `${origin}/indicacao/${code}` */
export function referralLink(code: string, origin: string = REFERRAL_SITE_ORIGIN): string {
  return `${origin}/indicacao/${code}`
}

/** The one helper every monthly-only check reads. */
export function isReferralEligiblePlan(plan: { billingInterval: string | null | undefined }): boolean {
  return plan.billingInterval === 'month'
}

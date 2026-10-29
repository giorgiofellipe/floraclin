import { normalizeReferralCode } from '@/lib/referral-rules'

export const APP_ORIGIN_DEFAULT = 'https://app.floraclin.com.br'

export type ReferralLookupResult = { active: true; clinicName: string } | { active: false }

/** The site's own switch; the app (web) stays authoritative for attribution. */
export function isReferralSiteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.REFERRAL_ENROLLMENT_ENABLED === 'true'
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/** The program end instant; same rule as web: full ISO with offset only (a bare date would be read as UTC). */
export function referralRewardsEndAt(env: Record<string, string | undefined> = process.env): Date | null {
  const raw = env.REFERRAL_REWARDS_END_AT?.trim()
  if (!raw || !ISO_WITH_OFFSET.test(raw)) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at
}

type LookupOpts = { origin?: string; fetchImpl?: typeof fetch }

function appOrigin(opts: LookupOpts): string {
  return opts.origin ?? (process.env.FLORACLIN_APP_ORIGIN || APP_ORIGIN_DEFAULT)
}

/** Whether the app has enrollment fully configured (switch, promotion code, coupons); any failure → false. */
export async function isAppEnrollmentOpen(opts: LookupOpts = {}): Promise<boolean> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${appOrigin(opts)}/api/referral/program`, { next: { revalidate: 60 } })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return !!body && typeof body === 'object' && (body as { enrollmentOpen?: unknown }).enrollmentOpen === true
  } catch {
    return false
  }
}

/**
 * The rules page is public while it winds down (an end date is set), or while the site switch is on and the app
 * agrees, so a half-configured app never has the offer advertised.
 */
export async function isReferralRulesPagePublished(
  env: Record<string, string | undefined> = process.env,
  opts: LookupOpts = {},
): Promise<boolean> {
  if (referralRewardsEndAt(env) !== null) return true
  return isReferralSiteEnabled(env) && (await isAppEnrollmentOpen(opts))
}

/** fetch(`${origin}/api/referral/codes/${code}`, { next: { revalidate: 60 } }); any failure → { active: false }. */
export async function lookupReferralCode(
  code: string,
  opts: LookupOpts = {},
): Promise<ReferralLookupResult> {
  const normalized = normalizeReferralCode(code)
  if (!normalized) return { active: false }
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(`${appOrigin(opts)}/api/referral/codes/${normalized}`, { next: { revalidate: 60 } })
    if (!res.ok) return { active: false }
    const body: unknown = await res.json()
    if (
      body &&
      typeof body === 'object' &&
      (body as { active?: unknown }).active === true &&
      typeof (body as { clinicName?: unknown }).clinicName === 'string' &&
      (body as { clinicName: string }).clinicName.trim() !== ''
    ) {
      return { active: true, clinicName: (body as { clinicName: string }).clinicName }
    }
    return { active: false }
  } catch {
    return { active: false }
  }
}

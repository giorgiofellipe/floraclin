import { normalizeReferralCode } from '@/lib/referral-rules'

export const APP_ORIGIN_DEFAULT = 'https://app.floraclin.com.br'

export type ReferralLookupResult = { active: true; clinicName: string } | { active: false }

/** The site's own switch; the app (web) stays authoritative for attribution. */
export function isReferralSiteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.REFERRAL_ENROLLMENT_ENABLED === 'true'
}

/** The program end instant, when set to a valid timestamp; otherwise null. */
export function referralRewardsEndAt(env: Record<string, string | undefined> = process.env): Date | null {
  const raw = env.REFERRAL_REWARDS_END_AT?.trim()
  if (!raw) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at
}

/** The rules page is public while the program is on, or while it winds down (an end date is set). */
export function isReferralRulesPagePublished(env: Record<string, string | undefined> = process.env): boolean {
  return isReferralSiteEnabled(env) || referralRewardsEndAt(env) !== null
}

/** fetch(`${origin}/api/referral/codes/${code}`, { next: { revalidate: 300 } }); any failure → { active: false }. */
export async function lookupReferralCode(
  code: string,
  opts: { origin?: string; fetchImpl?: typeof fetch } = {},
): Promise<ReferralLookupResult> {
  const normalized = normalizeReferralCode(code)
  if (!normalized) return { active: false }
  const origin = opts.origin ?? (process.env.FLORACLIN_APP_ORIGIN || APP_ORIGIN_DEFAULT)
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(`${origin}/api/referral/codes/${normalized}`, { next: { revalidate: 300 } })
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

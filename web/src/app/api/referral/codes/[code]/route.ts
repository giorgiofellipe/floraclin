import { NextResponse } from 'next/server'
import { findReferrerByCode } from '@/db/queries/referrals'
import { reportSideEffectFailure } from '@/lib/observability'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { normalizeReferralCode, shortClinicName } from '@/lib/referral/rules'

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600'

// Unknown, inactive, malformed, switch-off and error are indistinguishable on purpose.
function respond(body: { active: true; clinicName: string } | { active: false }, cacheControl = CACHE_CONTROL) {
  return NextResponse.json(body, { headers: { 'Cache-Control': cacheControl } })
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = normalizeReferralCode((await params).code)
    if (!code || !isReferralEnrollmentEnabled()) return respond({ active: false })

    const referrer = await findReferrerByCode(code)
    if (!referrer || !referrer.canRefer) return respond({ active: false })
    return respond({ active: true, clinicName: shortClinicName(referrer.name) })
  } catch (error) {
    reportSideEffectFailure(error, { area: 'referral', step: 'code_lookup' })
    return respond({ active: false }, 'no-store') // a transient failure must not be cached as "inactive"
  }
}

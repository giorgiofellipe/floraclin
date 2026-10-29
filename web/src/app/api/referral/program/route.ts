import { NextResponse } from 'next/server'
import { areReferralRewardsActive, isReferralEnrollmentEnabled } from '@/lib/referral/config'

// Public: lets the marketing site publish /indique only when the app will actually give the offer.
export async function GET() {
  return NextResponse.json(
    { enrollmentOpen: isReferralEnrollmentEnabled(), rewardsActive: areReferralRewardsActive() },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } },
  )
}

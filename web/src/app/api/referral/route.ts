import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getSubscription } from '@/db/queries/subscriptions'
import {
  countCountingReferrals,
  getOrCreateReferralCode,
  listPreviousReferralCodes,
  listReferralsForReferrer,
  listRewardEvents,
} from '@/db/queries/referrals'
import { areReferralRewardsActive, canRefer as isPayingReferrer, isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { isReferralEligiblePlan } from '@/lib/referral/rules'
import { buildReferralDashboard } from '@/lib/referral/dashboard'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isReferralEnrollmentEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const subscription = await getSubscription(ctx.tenantId)
    const canRefer = isPayingReferrer(subscription)
    const code = canRefer ? await getOrCreateReferralCode(ctx.tenantId) : null

    const [counting, referrals, events, previousCodes] = await Promise.all([
      countCountingReferrals(ctx.tenantId),
      listReferralsForReferrer(ctx.tenantId),
      listRewardEvents(ctx.tenantId, 10),
      canRefer ? listPreviousReferralCodes(ctx.tenantId) : Promise.resolve([]),
    ])

    const plan = subscription?.plan ?? null
    return NextResponse.json(
      buildReferralDashboard({
        canRefer,
        code,
        previousCodes,
        rewardsActive: areReferralRewardsActive(),
        counting,
        planPriceCents: plan?.priceCents ?? null,
        planEligible: plan ? isReferralEligiblePlan(plan) : false,
        nextInvoiceAt: canRefer ? (subscription?.currentPeriodEnd ?? null) : null,
        referrals,
        events,
      }),
    )
  } catch (error) {
    return handleApiError(error, request)
  }
}

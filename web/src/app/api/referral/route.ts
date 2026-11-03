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
import {
  areReferralRewardsActive,
  canRefer as isActiveReferrer,
  isReferralEnrollmentEnabled,
  subscribingUnlocksReferral,
} from '@/lib/referral/config'
import { isReferralDashboardVisible } from '@/lib/referral/dashboard-access'
import { isReferralEligiblePlan } from '@/lib/referral/rules'
import { buildReferralDashboard } from '@/lib/referral/dashboard'
import { isStripeDriven } from '@/lib/subscription-access'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!(await isReferralDashboardVisible(ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const enrollmentOpen = isReferralEnrollmentEnabled()
    const subscription = await getSubscription(ctx.tenantId)
    const canRefer = isActiveReferrer(subscription)
    const paying = canRefer && !!subscription && isStripeDriven(subscription)
    const code = canRefer && enrollmentOpen ? await getOrCreateReferralCode(ctx.tenantId) : null

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
        enrollmentOpen,
        subscribeToUnlock: enrollmentOpen && subscribingUnlocksReferral(subscription),
        code,
        previousCodes,
        rewardsActive: areReferralRewardsActive(),
        counting,
        planPriceCents: plan?.priceCents ?? null,
        // A grant earns no discount: there is no Stripe invoice to apply it to until the clinic subscribes.
        planEligible: paying && plan ? isReferralEligiblePlan(plan) : false,
        nextInvoiceAt: paying ? (subscription?.currentPeriodEnd ?? null) : null,
        referrals,
        events,
      }),
    )
  } catch (error) {
    return handleApiError(error, request)
  }
}

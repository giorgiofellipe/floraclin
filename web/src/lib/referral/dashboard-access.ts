import { isReferrer } from '@/db/queries/referrals'
import { areReferralRewardsActive, isReferralEnrollmentEnabled } from './config'

/** After enrollment closes, referrers keep the dashboard while their rewards still run. */
export async function isReferralDashboardVisible(tenantId: string): Promise<boolean> {
  if (isReferralEnrollmentEnabled()) return true
  return areReferralRewardsActive() && isReferrer(tenantId)
}

import { cookies } from 'next/headers'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { REFERRAL_COOKIE_NAME, normalizeReferralCode } from '@/lib/referral/rules'
import { ClinicDetailsForm } from './clinic-details-form'

export default async function ClinicDetailsPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const referralEnabled = isReferralEnrollmentEnabled()
  let defaultReferralCode: string | null = null
  if (referralEnabled) {
    const { ref } = await searchParams
    const cookieStore = await cookies()
    defaultReferralCode =
      normalizeReferralCode(Array.isArray(ref) ? ref[0] : ref) ??
      normalizeReferralCode(cookieStore.get(REFERRAL_COOKIE_NAME)?.value)
  }
  return <ClinicDetailsForm referralEnabled={referralEnabled} defaultReferralCode={defaultReferralCode} />
}

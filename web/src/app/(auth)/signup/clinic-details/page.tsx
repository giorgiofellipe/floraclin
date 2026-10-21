import { signupReferralDefaults } from '@/lib/referral/signup-default'
import { ClinicDetailsForm } from './clinic-details-form'

export default async function ClinicDetailsPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { referralEnabled, defaultReferralCode } = await signupReferralDefaults(searchParams)
  return <ClinicDetailsForm referralEnabled={referralEnabled} defaultReferralCode={defaultReferralCode} />
}

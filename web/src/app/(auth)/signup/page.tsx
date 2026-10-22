import { signupReferralDefaults } from '@/lib/referral/signup-default'
import { SignupForm } from './signup-form'

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { referralEnabled, defaultReferralCode } = await signupReferralDefaults(searchParams)
  return <SignupForm referralEnabled={referralEnabled} defaultReferralCode={defaultReferralCode} />
}

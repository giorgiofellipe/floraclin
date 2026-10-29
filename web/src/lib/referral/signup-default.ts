import { cookies } from 'next/headers'
import { isReferralEnrollmentEnabled } from './config'
import { REFERRAL_COOKIE_NAME, normalizeReferralCode } from './rules'

/** Signup pages: whether to show the code field, and its default (`?ref=` first, then the link cookie). */
export async function signupReferralDefaults(
  searchParams: Promise<{ ref?: string | string[] }>,
): Promise<{ referralEnabled: boolean; defaultReferralCode: string | null }> {
  const referralEnabled = isReferralEnrollmentEnabled()
  if (!referralEnabled) return { referralEnabled, defaultReferralCode: null }
  const { ref } = await searchParams
  const cookieStore = await cookies()
  return {
    referralEnabled,
    defaultReferralCode:
      normalizeReferralCode(Array.isArray(ref) ? ref[0] : ref) ??
      normalizeReferralCode(cookieStore.get(REFERRAL_COOKIE_NAME)?.value),
  }
}

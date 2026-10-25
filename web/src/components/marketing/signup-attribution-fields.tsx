'use client'

import { useSyncExternalStore } from 'react'
import { cookieConsentStatus, subscribeCookieConsent } from '@/lib/cookie-consent'

export function SignupAttributionFields() {
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')

  return <input type="hidden" name="marketingConsent" value={consentStatus} />
}

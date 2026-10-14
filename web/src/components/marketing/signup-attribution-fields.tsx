'use client'

import { useState, useSyncExternalStore } from 'react'
import { cookieConsentStatus, subscribeCookieConsent } from '@/lib/cookie-consent'
import { generateMetaEventId } from '@/lib/marketing-attribution'

interface SignupAttributionFieldsProps {
  eventPrefix?: string
}

export function SignupAttributionFields({ eventPrefix = 'complete_registration' }: SignupAttributionFieldsProps) {
  const [metaEventId] = useState(() => generateMetaEventId(eventPrefix))
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')
  const canUseMarketing = consentStatus === 'granted'

  return (
    <>
      <input type="hidden" name="marketingConsent" value={canUseMarketing ? 'granted' : ''} />
      <input type="hidden" name="metaEventId" value={canUseMarketing ? metaEventId : ''} />
    </>
  )
}

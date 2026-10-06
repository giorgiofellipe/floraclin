'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { cookieConsentStatus, subscribeCookieConsent } from '@/lib/cookie-consent'
import { attributionForSignup, generateMetaEventId } from '@/lib/marketing-attribution'

interface SignupAttributionFieldsProps {
  eventPrefix?: string
}

export function SignupAttributionFields({ eventPrefix = 'complete_registration' }: SignupAttributionFieldsProps) {
  const [metaEventId] = useState(() => generateMetaEventId(eventPrefix))
  const [, setRefreshKey] = useState(0)
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')
  const canUseMarketing = consentStatus === 'granted'
  const attribution = canUseMarketing ? attributionForSignup(metaEventId) : null

  useEffect(() => {
    const timeout = window.setTimeout(() => setRefreshKey((key) => key + 1), 300)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [consentStatus])

  return (
    <>
      <input type="hidden" name="marketingConsent" value={canUseMarketing ? 'granted' : ''} />
      <input type="hidden" name="metaEventId" value={canUseMarketing ? metaEventId : ''} />
      <input type="hidden" name="marketingAttribution" value={attribution ? JSON.stringify(attribution) : ''} />
    </>
  )
}

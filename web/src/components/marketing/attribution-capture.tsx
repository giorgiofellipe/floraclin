'use client'

import { useEffect } from 'react'
import { COOKIE_CONSENT_CHANGE_EVENT, hasMarketingConsent, type CookieConsentChoice } from '@/lib/cookie-consent'
import {
  captureFirstTouchAttribution,
  capturePendingFirstTouchAttribution,
  discardMarketingAttribution,
} from '@/lib/marketing-attribution'

export function AttributionCapture() {
  useEffect(() => {
    capturePendingFirstTouchAttribution()

    if (hasMarketingConsent()) {
      captureFirstTouchAttribution()
    }

    function handleConsentChange(event: Event) {
      const next = (event as CustomEvent<CookieConsentChoice>).detail
      if (next?.marketing) {
        captureFirstTouchAttribution()
      } else {
        discardMarketingAttribution()
      }
    }

    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, handleConsentChange)
    return () => window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, handleConsentChange)
  }, [])

  return null
}

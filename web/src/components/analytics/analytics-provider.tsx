'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { cookieConsentStatus, subscribeCookieConsent } from '@/lib/cookie-consent'
import { analyticsConsentGranted, clearPostHogStorage } from '@/lib/analytics/consent'
import {
  applyAnalyticsConsent,
  identifyAnalyticsUser,
  initAnalytics,
  resetAnalytics,
  setAnalyticsSuppressed,
} from '@/lib/analytics/client'

interface AnalyticsProviderProps {
  /** The signed-in user. Omitted on signed-out pages (login, signup, confirm-email). */
  userId?: string | null
  tenantId?: string | null
  /** False where nothing may be tracked (a platform admin's session). */
  enabled?: boolean
}

/**
 * Starts PostHog on the app's own pages: auth, onboarding and the platform.
 * Deliberately not in the root layout, which also serves patient-facing pages
 * (booking, anamnesis, signatures) where nothing is tracked.
 */
export function AnalyticsProvider({ userId, tenantId, enabled = true }: AnalyticsProviderProps) {
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')

  useEffect(() => {
    setAnalyticsSuppressed(!enabled)
  }, [enabled])

  useEffect(() => {
    // Read the stored choice rather than the hydration snapshot ('unset' on
    // the first pass): starting cookieless and upgrading a moment later would
    // throw away a consenting visitor's persisted id on every page load.
    const granted = analyticsConsentGranted()
    if (enabled) {
      void initAnalytics({ consentGranted: granted })
      return
    }
    // Not tracked here, but a withdrawal still has to clear what is stored,
    // even before this tab has a PostHog instance.
    if (!granted) clearPostHogStorage()
    void applyAnalyticsConsent(granted)
  }, [consentStatus, enabled])

  useEffect(() => {
    if (!enabled) return
    if (userId) identifyAnalyticsUser(userId, tenantId ?? null)
    else resetAnalytics({ onlyIfIdentified: true })
  }, [userId, tenantId, enabled])

  return null
}

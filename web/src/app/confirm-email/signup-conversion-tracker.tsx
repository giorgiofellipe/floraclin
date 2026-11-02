'use client'

import { useEffect } from 'react'
import { trackMetaEvent } from '@/lib/marketing-attribution'

const META_EVENT_ID_PARAM = 'meta_event_id'

interface SignupConversionTrackerProps {
  eventId: string | null
}

export function SignupConversionTracker({ eventId }: SignupConversionTrackerProps) {
  useEffect(() => {
    if (!eventId) return
    trackMetaEvent('CompleteRegistration', { status: 'trial_started' }, eventId)
    // Fired once: left in the URL, every reload or return to the page would
    // fire it again. The id is already captured above, and the server event
    // carries the same one, so Meta's deduplication is unaffected.
    const url = new URL(window.location.href)
    if (!url.searchParams.has(META_EVENT_ID_PARAM)) return
    url.searchParams.delete(META_EVENT_ID_PARAM)
    window.history.replaceState(window.history.state, '', url)
  }, [eventId])

  return null
}

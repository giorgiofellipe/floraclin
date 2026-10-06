'use client'

import { useEffect } from 'react'
import { trackMetaEvent } from '@/lib/marketing-attribution'

interface SignupConversionTrackerProps {
  eventId: string | null
}

export function SignupConversionTracker({ eventId }: SignupConversionTrackerProps) {
  useEffect(() => {
    if (!eventId) return
    trackMetaEvent('CompleteRegistration', { status: 'trial_started' }, eventId)
  }, [eventId])

  return null
}

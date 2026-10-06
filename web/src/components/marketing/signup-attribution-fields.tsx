'use client'

import { useEffect, useState } from 'react'
import { attributionForSignup, generateMetaEventId } from '@/lib/marketing-attribution'

interface SignupAttributionFieldsProps {
  eventPrefix?: string
}

export function SignupAttributionFields({ eventPrefix = 'complete_registration' }: SignupAttributionFieldsProps) {
  const [metaEventId] = useState(() => generateMetaEventId(eventPrefix))
  const [attribution, setAttribution] = useState('')

  useEffect(() => {
    function refreshAttribution() {
      const next = attributionForSignup(metaEventId)
      setAttribution(next ? JSON.stringify(next) : '')
    }

    refreshAttribution()
    const timeout = window.setTimeout(refreshAttribution, 300)
    return () => window.clearTimeout(timeout)
  }, [metaEventId])

  return (
    <>
      <input type="hidden" name="metaEventId" value={metaEventId} />
      <input type="hidden" name="marketingAttribution" value={attribution} />
    </>
  )
}

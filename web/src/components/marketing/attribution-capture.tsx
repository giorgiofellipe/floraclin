'use client'

import { useEffect } from 'react'
import { captureFirstTouchAttribution } from '@/lib/marketing-attribution'

export function AttributionCapture() {
  useEffect(() => {
    captureFirstTouchAttribution()
  }, [])

  return null
}

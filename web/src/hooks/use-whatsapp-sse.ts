'use client'

import { useEffect, useRef } from 'react'

interface WhatsappSseCallbacks {
  onMessage?: (data: unknown) => void
  onStatusUpdate?: (data: unknown) => void
  onNewConversation?: (data: unknown) => void
  onProspectUpdated?: (data: unknown) => void
  onQueueDrained?: (data: unknown) => void
  onQueueExpired?: (data: unknown) => void
}

export function useWhatsappSse(callbacks: WhatsappSseCallbacks, enabled = true) {
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  useEffect(() => {
    if (!enabled) return

    const es = new EventSource('/api/whatsapp/stream')

    es.addEventListener('new_message', (e) => {
      callbacksRef.current.onMessage?.(JSON.parse(e.data))
    })

    es.addEventListener('status_update', (e) => {
      callbacksRef.current.onStatusUpdate?.(JSON.parse(e.data))
    })

    es.addEventListener('new_conversation', (e) => {
      callbacksRef.current.onNewConversation?.(JSON.parse(e.data))
    })

    es.addEventListener('prospect_updated', (e) => {
      callbacksRef.current.onProspectUpdated?.(JSON.parse(e.data))
    })

    es.addEventListener('queue_drained', (e) => {
      callbacksRef.current.onQueueDrained?.(JSON.parse(e.data))
    })

    es.addEventListener('queue_expired', (e) => {
      callbacksRef.current.onQueueExpired?.(JSON.parse(e.data))
    })

    return () => es.close()
  }, [enabled])
}

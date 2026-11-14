'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { toWaMeUrl, tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'

/**
 * WhatsApp entry for a patient: the in-app conversation when the clinic's
 * WhatsApp is usable by this role and the phone is valid, otherwise wa.me.
 */
export function usePatientWhatsapp(patient: { id: string; phone: string }, inAppAllowed: boolean) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const canUseInApp = inAppAllowed && tryNormalizeBrPhoneForWhatsApp(patient.phone).ok
  const waHref = toWaMeUrl(patient.phone)

  async function openInApp() {
    setOpening(true)
    try {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao abrir conversa' }))
        throw new Error(err.error || 'Erro ao abrir conversa')
      }
      const data = await res.json()
      router.push(`/whatsapp?conversa=${data.data.conversation.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir conversa')
    } finally {
      setOpening(false)
    }
  }

  return { canUseInApp, waHref, opening, openInApp }
}

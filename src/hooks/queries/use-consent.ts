'use client'

import { useQuery } from '@tanstack/react-query'
import { listConsentTemplatesAction, getConsentHistoryAction } from '@/actions/consent'

export function useConsentTemplates() {
  return useQuery({
    queryKey: ['consent', 'templates'],
    queryFn: () => listConsentTemplatesAction(),
  })
}

export function useConsentHistory(patientId: string | undefined) {
  return useQuery({
    queryKey: ['consent', 'history', patientId],
    queryFn: () => getConsentHistoryAction(patientId!),
    enabled: !!patientId,
  })
}

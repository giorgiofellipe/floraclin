'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { PendingConsentItem } from '@/db/queries/consent'

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useConsentTemplates() {
  return useQuery({
    queryKey: queryKeys.consent.templates,
    queryFn: () => fetchJson('/api/consent/templates'),
  })
}

export function useConsentHistory(patientId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.consent.history(patientId!),
    queryFn: () => fetchJson(`/api/consent/history/${patientId}`),
    enabled: !!patientId,
  })
}

export function usePendingConsents(patientId: string) {
  return useQuery<PendingConsentItem[]>({
    queryKey: ['consent', 'pending', patientId],
    queryFn: async () => (await fetchJson(`/api/consent/pending/${patientId}`)).data,
    enabled: !!patientId,
  })
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useAnamnesis(patientId: string) {
  return useQuery({
    queryKey: queryKeys.anamnesis(patientId),
    queryFn: async () => {
      const res = await fetch(`/api/anamnesis/${patientId}`)
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    enabled: !!patientId,
  })
}

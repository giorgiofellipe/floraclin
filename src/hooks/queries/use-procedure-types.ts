'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useProcedureTypes() {
  return useQuery({
    queryKey: queryKeys.procedureTypes,
    queryFn: async () => {
      const res = await fetch('/api/procedure-types')
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })
}

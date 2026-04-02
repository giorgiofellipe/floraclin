'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

interface ProcedureTypeBreakdown {
  name: string
  revenue: number
  count: number
}

interface PractitionerPL {
  practitionerId: string
  practitionerName: string
  revenueGenerated: number
  revenueCollected: number
  procedureCount: number
  averageTicket: number
  byProcedureType: ProcedureTypeBreakdown[]
}

export function usePractitionerPL(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  return useQuery<PractitionerPL[]>({
    queryKey: queryKeys.financial.practitionerPL(dateFrom, dateTo, practitionerId),
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (practitionerId) params.set('practitionerId', practitionerId)

      const res = await fetch(`/api/financial/practitioner-pl?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar P&L por profissional')
      }
      return res.json()
    },
    enabled: !!dateFrom && !!dateTo,
  })
}

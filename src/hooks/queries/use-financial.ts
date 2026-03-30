'use client'

import { useQuery } from '@tanstack/react-query'
import { listFinancialEntriesAction, getRevenueOverviewAction } from '@/actions/financial'
import { listPatientsAction } from '@/actions/patients'
import { queryKeys } from './query-keys'

export function useFinancialEntries(filters?: {
  patientId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: queryKeys.financial.entries(filters as Record<string, unknown>),
    queryFn: () => listFinancialEntriesAction(filters ?? {}),
  })
}

export function useRevenueOverview(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  return useQuery({
    queryKey: queryKeys.financial.revenue(dateFrom, dateTo, practitionerId),
    queryFn: () => getRevenueOverviewAction(dateFrom, dateTo, practitionerId),
    enabled: !!dateFrom && !!dateTo,
  })
}

export function useFinancialPatients() {
  return useQuery({
    queryKey: queryKeys.financial.patients,
    queryFn: async () => {
      const result = await listPatientsAction('', 1, 500)
      return result.data.map((p) => ({
        id: p.id,
        fullName: p.fullName,
      }))
    },
  })
}

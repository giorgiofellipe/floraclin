'use client'

import { useQuery } from '@tanstack/react-query'
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
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.patientId) params.set('patientId', filters.patientId)
      if (filters?.status) params.set('status', filters.status)
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters?.dateTo) params.set('dateTo', filters.dateTo)
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.limit) params.set('limit', String(filters.limit))
      const res = await fetch(`/api/financial?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar financeiro')
      }
      return res.json()
    },
  })
}

export function useRevenueOverview(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  return useQuery({
    queryKey: queryKeys.financial.revenue(dateFrom, dateTo, practitionerId),
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (practitionerId) params.set('practitionerId', practitionerId)
      const res = await fetch(`/api/financial/overview?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar receita')
      }
      return res.json()
    },
    enabled: !!dateFrom && !!dateTo,
  })
}

export function useFinancialPatients() {
  return useQuery({
    queryKey: queryKeys.financial.patients,
    queryFn: async () => {
      const res = await fetch('/api/financial/patients')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar pacientes')
      }
      return res.json()
    },
  })
}

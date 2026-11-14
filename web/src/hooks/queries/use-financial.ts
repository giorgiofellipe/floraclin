'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { FinancialOverview } from '@/db/queries/financial'

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

export function useFinancialOverview(month: string) {
  return useQuery({
    queryKey: queryKeys.financial.overview(month),
    queryFn: async () => {
      const res = await fetch(`/api/financial/overview?month=${month}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar a visão geral')
      }
      return res.json() as Promise<FinancialOverview>
    },
    placeholderData: keepPreviousData,
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

'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

interface LedgerFilters {
  type?: string
  dateFrom: string
  dateTo: string
  paymentMethod?: string
  patientId?: string
  categoryId?: string
  page?: number
  limit?: number
}

interface LedgerMovement {
  id: string
  type: 'inflow' | 'outflow'
  amount: string
  description: string
  paymentMethod: string | null
  movementDate: string
  patientName: string | null
  categoryName: string | null
  runningBalance: number
}

interface LedgerSummary {
  totalInflows: number
  totalOutflows: number
  netResult: number
  overdueReceivables: number
}

interface LedgerResponse {
  movements: LedgerMovement[]
  summary: LedgerSummary
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export function useLedger(filters: LedgerFilters) {
  return useQuery<LedgerResponse>({
    queryKey: queryKeys.financial.ledger(filters as unknown as Record<string, unknown>),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('dateFrom', filters.dateFrom)
      params.set('dateTo', filters.dateTo)
      if (filters.type) params.set('type', filters.type)
      if (filters.paymentMethod) params.set('paymentMethod', filters.paymentMethod)
      if (filters.patientId) params.set('patientId', filters.patientId)
      if (filters.categoryId) params.set('categoryId', filters.categoryId)
      if (filters.page) params.set('page', String(filters.page))
      if (filters.limit) params.set('limit', String(filters.limit))

      const res = await fetch(`/api/financial/ledger?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar extrato')
      }
      return res.json()
    },
    enabled: !!filters.dateFrom && !!filters.dateTo,
  })
}

export function useLedgerExportUrl(filters: Omit<LedgerFilters, 'page' | 'limit'>) {
  const params = new URLSearchParams()
  params.set('dateFrom', filters.dateFrom)
  params.set('dateTo', filters.dateTo)
  if (filters.type) params.set('type', filters.type)
  if (filters.paymentMethod) params.set('paymentMethod', filters.paymentMethod)
  if (filters.patientId) params.set('patientId', filters.patientId)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)

  return `/api/financial/ledger/export?${params}`
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useExpenses(filters?: {
  status?: string
  categoryId?: string
  isOverdue?: boolean
  paymentMethod?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: queryKeys.expenses.list(filters as Record<string, unknown>),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.categoryId) params.set('categoryId', filters.categoryId)
      if (filters?.isOverdue !== undefined) params.set('isOverdue', String(filters.isOverdue))
      if (filters?.paymentMethod) params.set('paymentMethod', filters.paymentMethod)
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters?.dateTo) params.set('dateTo', filters.dateTo)
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.limit) params.set('limit', String(filters.limit))
      const res = await fetch(`/api/expenses?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar despesas')
      }
      return res.json()
    },
  })
}

export function useExpenseDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.expenses.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/expenses/${id}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar despesa')
      }
      return res.json()
    },
    enabled: !!id,
  })
}

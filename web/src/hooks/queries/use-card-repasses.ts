'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { CardRepasseListRow } from '@/db/queries/card-payments'

export interface CardRepasseFilters {
  dateFrom: string
  dateTo: string
  terminalId?: string
  status?: 'pending' | 'received' | 'cancelled'
  page: number
  limit: number
}

export interface CardRepassesResponse {
  data: CardRepasseListRow[]
  total: number
  pendingNetTotal: number
}

async function requestJson(url: string, method: string, data?: unknown) {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useCardRepasses(filters: CardRepasseFilters) {
  return useQuery({
    queryKey: queryKeys.financial.cardRepasses(filters),
    queryFn: (): Promise<CardRepassesResponse> => {
      const params = new URLSearchParams({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        page: String(filters.page),
        limit: String(filters.limit),
      })
      if (filters.terminalId) params.set('terminalId', filters.terminalId)
      if (filters.status) params.set('status', filters.status)
      return requestJson(`/api/financial/card-repasses?${params}`, 'GET')
    },
    placeholderData: keepPreviousData,
  })
}

export function useAdjustCardRepasse() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; netAmount: number; expectedDate: string }) =>
      requestJson(`/api/financial/card-repasses/${id}`, 'PATCH', data),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.financial.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]),
  })
}

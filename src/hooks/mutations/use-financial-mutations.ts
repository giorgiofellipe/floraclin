'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

async function mutateJson(url: string, method: string, data?: unknown) {
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

export function useCreateFinancialEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/financial', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function usePayInstallment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paymentMethod }: { id: string; paymentMethod: string }) =>
      mutateJson(`/api/financial/installments/${id}/pay`, 'PUT', { paymentMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

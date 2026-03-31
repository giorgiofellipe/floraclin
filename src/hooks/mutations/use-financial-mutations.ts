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
    mutationFn: ({
      id,
      amount,
      paymentMethod,
      paidAt,
      notes,
    }: {
      id: string
      amount: number
      paymentMethod: string
      paidAt?: string
      notes?: string
    }) =>
      mutateJson(`/api/financial/installments/${id}/pay`, 'PUT', {
        amount,
        paymentMethod,
        paidAt,
        notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useRenegotiate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      entryIds: string[]
      newInstallmentCount: number
      description: string
      waivePenalties?: boolean
      waiveAmount?: number
    }) => mutateJson('/api/financial/renegotiate', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useBulkPay() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      installmentIds: string[]
      paymentMethod: string
      paidAt?: string
    }) => mutateJson('/api/financial/bulk/pay', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useBulkCancel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      entryIds: string[]
      reason: string
    }) => mutateJson('/api/financial/bulk/cancel', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

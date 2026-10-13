'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

/** A failed request, carrying the `code` a BusinessError response includes. */
export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function mutateJson(url: string, method: string, data?: unknown) {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new ApiError(error.error || `HTTP ${res.status}`, error.code)
  }
  return res.json()
}

export function useCreateFinancialEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/financial', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
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
      expectedTotalDue,
      acceptOverpayment,
    }: {
      id: string
      amount: number
      paymentMethod: string
      paidAt?: string
      notes?: string
      expectedTotalDue: number
      acceptOverpayment?: boolean
    }) =>
      mutateJson(`/api/financial/installments/${id}/pay`, 'PUT', {
        amount,
        paymentMethod,
        paidAt,
        notes,
        expectedTotalDue,
        acceptOverpayment,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
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
      newTotalAmount?: number
      description: string
      waivePenalties?: boolean
      waiveAmount?: number
      customDueDates?: string[]
    }) => mutateJson('/api/financial/renegotiate', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
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
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
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
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useBulkUncancel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      entryIds: string[]
      reason: string
    }) => mutateJson('/api/financial/bulk/uncancel', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useReversePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ paymentRecordId, reason }: { paymentRecordId: string; reason?: string }) =>
      mutateJson(`/api/financial/payments/${paymentRecordId}/reverse`, 'POST', { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: ['financial', 'detail'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'revenue'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'ledger'] })
      queryClient.invalidateQueries({ queryKey: ['financial', 'practitioner-pl'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

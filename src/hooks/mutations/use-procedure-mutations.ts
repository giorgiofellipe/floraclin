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

export function useCreateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/procedures', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useUpdateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      mutateJson(`/api/procedures/${id}`, 'PUT', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.detail(variables.id) })
    },
  })
}

export function useApproveProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mutateJson(`/api/procedures/${id}/approve`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useExecuteProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      mutateJson(`/api/procedures/${id}/execute`, 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useCancelProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      mutateJson(`/api/procedures/${id}/cancel`, 'POST', { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

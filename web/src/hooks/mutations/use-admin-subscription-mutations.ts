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

export function useUpdateSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, ...data }: { tenantId: string } & Record<string, unknown>) =>
      mutateJson(`/api/admin/subscriptions/${tenantId}`, 'PATCH', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.subscriptions.all })
    },
  })
}

export function useGiftSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, ...data }: { tenantId: string; planSlug: string; months: number; notes?: string }) =>
      mutateJson(`/api/admin/subscriptions/${tenantId}/gift`, 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.subscriptions.all })
    },
  })
}

export function useExtendTrial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, days }: { tenantId: string; days: number }) =>
      mutateJson(`/api/admin/subscriptions/${tenantId}/extend-trial`, 'POST', { days }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.subscriptions.all })
    },
  })
}

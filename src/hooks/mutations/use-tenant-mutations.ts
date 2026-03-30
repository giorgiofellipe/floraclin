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

export function useUpdateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/tenant', 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenant.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.tenant })
    },
  })
}

export function useUpdateBookingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      mutateJson('/api/tenant', 'PUT', { ...data, _action: 'booking_settings' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenant.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.tenant })
    },
  })
}

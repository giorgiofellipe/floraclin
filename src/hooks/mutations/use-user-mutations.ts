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

export function useInviteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/tenant/users/invite', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenant.users })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.members })
    },
  })
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      mutateJson(`/api/tenant/users/${id}/role`, 'PUT', { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenant.users })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.members })
    },
  })
}

export function useDeactivateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mutateJson(`/api/tenant/users/${id}/deactivate`, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenant.users })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.members })
    },
  })
}

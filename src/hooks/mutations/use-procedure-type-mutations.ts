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

export function useCreateProcedureType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/procedure-types', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedureTypes })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.procedureTypes })
    },
  })
}

export function useUpdateProcedureType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      mutateJson(`/api/procedure-types/${id}`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedureTypes })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.procedureTypes })
    },
  })
}

export function useDeleteProcedureType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mutateJson(`/api/procedure-types/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedureTypes })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.procedureTypes })
    },
  })
}

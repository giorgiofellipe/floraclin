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

export function useCreatePatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/patients', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useUpdatePatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      mutateJson(`/api/patients/${id}`, 'PUT', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.detail(variables.id) })
    },
  })
}

export function useDeletePatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mutateJson(`/api/patients/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

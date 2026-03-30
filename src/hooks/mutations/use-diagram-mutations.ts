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

export function useSaveFaceDiagram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/face-diagrams', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
    },
  })
}

export function useSaveProductApplications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/product-applications', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
    },
  })
}

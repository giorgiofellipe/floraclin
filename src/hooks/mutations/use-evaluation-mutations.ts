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

export function useSaveEvaluationTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/evaluation/templates', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    },
  })
}

export function useSaveEvaluationResponse() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/evaluation/responses', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.all })
    },
  })
}

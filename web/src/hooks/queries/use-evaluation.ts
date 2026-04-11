'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useEvaluationTemplates(typeIds: string[]) {
  return useQuery({
    queryKey: queryKeys.evaluation.templates(typeIds),
    queryFn: () => fetchJson(`/api/evaluation/templates?typeIds=${typeIds.join(',')}`),
    enabled: typeIds.length > 0,
  })
}

export function useEvaluationResponses(procedureId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.evaluation.responses(procedureId!),
    queryFn: () => fetchJson(`/api/evaluation/responses/${procedureId}`),
    enabled: !!procedureId,
  })
}

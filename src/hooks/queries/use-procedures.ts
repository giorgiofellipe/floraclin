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

export function useProcedures(patientId: string) {
  return useQuery({
    queryKey: queryKeys.procedures.list(patientId),
    queryFn: () => fetchJson(`/api/procedures?patientId=${patientId}`),
    enabled: !!patientId,
  })
}

export function useProcedure(id: string) {
  return useQuery({
    queryKey: queryKeys.procedures.detail(id),
    queryFn: () => fetchJson(`/api/procedures/${id}`),
    enabled: !!id,
  })
}

export function useLatestNonExecutedProcedure(patientId: string) {
  return useQuery({
    queryKey: queryKeys.procedures.latestNonExecuted(patientId),
    queryFn: () => fetchJson(`/api/procedures/latest?patientId=${patientId}`),
    enabled: !!patientId,
  })
}

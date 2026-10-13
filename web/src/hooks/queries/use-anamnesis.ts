'use client'

import { useQuery } from '@tanstack/react-query'
import type { AnamnesisRecord, AnamnesisTemplate } from '@/lib/anamnesis/types'
import { throwIfNotOk } from '../throw-if-not-ok'
import { queryKeys } from './query-keys'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  await throwIfNotOk(res)
  return res.json()
}

export function fetchAnamnesis(patientId: string): Promise<AnamnesisRecord | null> {
  return getJson(`/api/anamnesis/${patientId}`)
}

export function fetchAnamnesisTemplate(): Promise<AnamnesisTemplate> {
  return getJson('/api/anamnesis/template')
}

export function useAnamnesis(patientId: string) {
  return useQuery({
    queryKey: queryKeys.anamnesis(patientId),
    queryFn: () => fetchAnamnesis(patientId),
    enabled: !!patientId,
  })
}

export function useAnamnesisTemplate() {
  return useQuery({
    queryKey: queryKeys.anamnesisTemplate,
    queryFn: fetchAnamnesisTemplate,
  })
}

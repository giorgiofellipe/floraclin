'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from './query-keys'

export interface MetaConnectionSummary {
  id: string
  datasetId: string
  businessId: string | null
  connectionType: 'oauth' | 'manual'
  tokenExpiresAt: string | null
  testEventCode: string | null
  advancedMatchingEnabled: boolean
  status: string
  acknowledgedAt: string | null
  acknowledgementVersion: string | null
  lastVerifiedAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface MetaEventRow {
  id: string
  prospectId: string | null
  eventName: string
  eventId: string
  status: string
  skipReason: string | null
  attempts: number
  lastError: string | null
  fbTraceId: string | null
  sentAt: string | null
  createdAt: string
}

interface MetaConnectionResponse {
  data: MetaConnectionSummary | null
  events: MetaEventRow[]
}

export function useMetaConnection() {
  return useQuery<MetaConnectionResponse>({
    queryKey: queryKeys.meta.connection,
    queryFn: async () => {
      const res = await fetch('/api/integrations/meta/connection')
      if (!res.ok) throw new Error('Erro ao carregar conexão')
      return res.json()
    },
  })
}

export interface SaveMetaConnectionInput {
  datasetId: string
  accessToken: string
  testEventCode?: string | null
  advancedMatchingEnabled?: boolean
  acknowledgementVersion: string
}

export function useSaveMetaConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveMetaConnectionInput) => {
      const res = await fetch('/api/integrations/meta/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar conexão')
      return json.data as MetaConnectionSummary
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meta.connection })
    },
  })
}

export function useDisconnectMeta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/integrations/meta/connection', { method: 'DELETE' })
      if (!res.ok) throw new Error('Erro ao desconectar')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meta.connection })
    },
  })
}

export interface MetaTestResult {
  ok: boolean
  body: unknown
}

export function useTestMetaConnection() {
  return useMutation<MetaTestResult>({
    mutationFn: async () => {
      const res = await fetch('/api/integrations/meta/connection/test', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      return { ok: res.ok, body }
    },
  })
}

export interface MetaDataset {
  id: string
  name: string
}

export function useMetaDatasets() {
  return useMutation<MetaDataset[], Error, { businessId: string; accessToken?: string }>({
    mutationFn: async ({ businessId, accessToken }) => {
      const res = await fetch('/api/integrations/meta/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, accessToken }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Erro ao listar datasets')
      return (json.data ?? []) as MetaDataset[]
    },
  })
}

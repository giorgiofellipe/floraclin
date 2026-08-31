'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from './query-keys'

export interface MetaConnectionSummary {
  id: string
  /** Null while status is 'pending_dataset'. */
  datasetId: string | null
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
  /** Omit to keep the stored credentials and update settings only. */
  accessToken?: string
  testEventCode?: string | null
  advancedMatchingEnabled?: boolean
  /** Omitted only when completing leg 2 of the OAuth flow. */
  acknowledgementVersion?: string
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

/**
 * Meta's own verdict on the probe event. The route answers 200 with the
 * verdict in the body, so `ok` here is never the HTTP status: a rejected
 * event arrives as a 200 whose body says `ok: false`.
 */
export type MetaTestResult =
  | { ok: true; eventsReceived: number; fbTraceId?: string }
  | { ok: false; message: string; errorUserTitle?: string; fbTraceId?: string }

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function useTestMetaConnection() {
  return useMutation<MetaTestResult>({
    mutationFn: async () => {
      const res = await fetch('/api/integrations/meta/connection/test', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

      // A non-2xx is our own route refusing before it called Meta (not the
      // owner, no connection, no dataset). There is no verdict to read.
      if (!res.ok) {
        throw new Error(readString(body.error) ?? 'Falha ao testar a conexão')
      }

      if (body.ok === true) {
        return {
          ok: true,
          eventsReceived: typeof body.eventsReceived === 'number' ? body.eventsReceived : 0,
          fbTraceId: readString(body.fbTraceId),
        }
      }

      return {
        ok: false,
        message: readString(body.message) ?? 'A Meta recusou o evento de teste.',
        errorUserTitle: readString(body.errorUserTitle),
        fbTraceId: readString(body.fbTraceId),
      }
    },
  })
}

export interface MetaBusiness {
  id: string
  name: string
}

export interface MetaDataset {
  id: string
  name: string
}

/**
 * The routes walk Graph's paging up to a cap, so a very large account can come
 * back short. `truncated` lets the picker say so instead of presenting a
 * partial list as complete.
 */
export interface MetaPickerList<T> {
  items: T[]
  truncated: boolean
}

function readPickerList<T>(json: Record<string, unknown>): MetaPickerList<T> {
  return {
    items: (json.data ?? []) as T[],
    truncated: json.truncated === true,
  }
}

/** Leg 2 of the OAuth flow: the portfolios the stored token can read. */
export function useMetaBusinesses(enabled: boolean) {
  return useQuery<MetaPickerList<MetaBusiness>>({
    queryKey: queryKeys.meta.businesses,
    enabled,
    queryFn: async () => {
      const res = await fetch('/api/integrations/meta/businesses')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Erro ao listar portfólios')
      return readPickerList<MetaBusiness>(json)
    },
  })
}

export function useMetaDatasets() {
  return useMutation<
    MetaPickerList<MetaDataset>,
    Error,
    { businessId: string; accessToken?: string }
  >({
    mutationFn: async ({ businessId, accessToken }) => {
      const res = await fetch('/api/integrations/meta/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, accessToken }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Erro ao listar datasets')
      return readPickerList<MetaDataset>(json)
    },
  })
}

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FollowupChannel,
  FollowupOutcome,
} from '@/validations/followup'

/**
 * Row shape returned by GET /api/planejamentos. Mirrors
 * `OpenPlanejamentoRow` from `web/src/db/queries/followups.ts`.
 */
export interface OpenPlanejamento {
  id: string
  patientId: string
  patientName: string
  patientPhone: string
  procedureTypeId: string
  procedureTypeName: string
  practitionerId: string
  practitionerName: string
  status: string
  performedAt: string
  followUpDate: string | null
  totalAmount: string | null
  createdAt: string
  lastContactedAt: string | null
  snoozedUntil: string | null
}

export interface OpenPlanejamentosFilters {
  practitionerId?: string
  procedureTypeId?: string
  includeSnoozed?: boolean
  limit?: number
}

const planejamentosKey = (filters: OpenPlanejamentosFilters) =>
  ['planejamentos', 'open', filters] as const

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function buildSearchParams(filters: OpenPlanejamentosFilters): string {
  const params = new URLSearchParams()
  if (filters.practitionerId) params.set('practitionerId', filters.practitionerId)
  if (filters.procedureTypeId) params.set('procedureTypeId', filters.procedureTypeId)
  if (filters.includeSnoozed) params.set('includeSnoozed', 'true')
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useOpenPlanejamentos(filters: OpenPlanejamentosFilters = {}) {
  return useQuery<{ data: OpenPlanejamento[] }>({
    queryKey: planejamentosKey(filters),
    queryFn: () =>
      fetchJson<{ data: OpenPlanejamento[] }>(
        `/api/planejamentos${buildSearchParams(filters)}`,
      ),
  })
}

/**
 * Row shape returned by GET /api/procedures/:id/followups.
 * Matches what `<FollowupTimeline>` expects, modulo the date being an ISO string.
 */
export interface ProcedureFollowupRow {
  id: string
  contactedAt: string
  contactedById: string
  contactedByName: string | null
  channel: FollowupChannel
  outcome: FollowupOutcome
  notes: string | null
}

const followupsForProcedureKey = (procedureRecordId: string) =>
  ['planejamentos', 'followups', procedureRecordId] as const

export function useFollowupsForProcedure(procedureRecordId: string) {
  return useQuery<{ data: ProcedureFollowupRow[] }>({
    queryKey: followupsForProcedureKey(procedureRecordId),
    enabled: !!procedureRecordId,
    queryFn: () =>
      fetchJson<{ data: ProcedureFollowupRow[] }>(
        `/api/procedures/${procedureRecordId}/followups`,
      ),
  })
}

export interface RecordFollowupInput {
  procedureRecordId: string
  channel: FollowupChannel
  outcome: FollowupOutcome
  notes?: string
}

export interface RecordFollowupResponse {
  success: true
  data: {
    followupId: string
    cancelledProcedure: boolean
  }
}

export function useRecordFollowup() {
  const qc = useQueryClient()
  return useMutation<RecordFollowupResponse, Error, RecordFollowupInput>({
    mutationFn: ({ procedureRecordId, ...body }) =>
      fetchJson<RecordFollowupResponse>(
        `/api/procedures/${procedureRecordId}/followups`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planejamentos'] })
      qc.invalidateQueries({ queryKey: ['procedures'] })
    },
  })
}

export interface SnoozeProcedureInput {
  procedureRecordId: string
  until: string | null
}

export interface SnoozeProcedureResponse {
  success: true
  data: { snoozedUntil: string | null }
}

export function useSnoozeProcedure() {
  const qc = useQueryClient()
  return useMutation<SnoozeProcedureResponse, Error, SnoozeProcedureInput>({
    mutationFn: ({ procedureRecordId, until }) =>
      fetchJson<SnoozeProcedureResponse>(
        `/api/procedures/${procedureRecordId}/snooze`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ until }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planejamentos'] })
      qc.invalidateQueries({ queryKey: ['procedures'] })
    },
  })
}

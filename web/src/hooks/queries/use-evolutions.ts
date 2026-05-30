'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  EvolutionFeedEntry,
  EvolutionRevision,
} from '@/db/queries/patient-evolutions'

/**
 * Centralized query keys for the evoluções feed and per-note revisions.
 * Mutation hooks call `feed(patientId)` / `revisions(patientId, noteId)` to
 * scope invalidations precisely.
 */
export const evolutionsKeys = {
  feed: (patientId: string) =>
    ['patients', patientId, 'evolutions'] as const,
  revisions: (patientId: string, noteId: string) =>
    ['patients', patientId, 'evolutions', noteId, 'revisions'] as const,
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

/**
 * Fetch the merged evoluções feed (sessions + free-text notes) for a
 * patient. Returns the `entries` array directly per RA-7 (no envelope).
 * The feed endpoint enforces tenant + patient scope server-side.
 */
export function useEvolutions(patientId: string) {
  return useQuery({
    queryKey: evolutionsKeys.feed(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const { entries } = await fetchJson<{ entries: EvolutionFeedEntry[] }>(
        `/api/patients/${patientId}/evolutions`,
      )
      return entries
    },
  })
}

/**
 * Fetch the edit history for a single note. Disabled when `noteId` is
 * falsy so consumers can call this hook unconditionally (e.g. when a
 * drawer is closed). Returns the `revisions` array directly per RA-7.
 */
export function useEvolutionRevisions(
  patientId: string,
  noteId: string | null,
  opts?: { enabled?: boolean },
) {
  const enabledByCaller = opts?.enabled ?? true
  return useQuery({
    queryKey: evolutionsKeys.revisions(patientId, noteId ?? ''),
    enabled: enabledByCaller && !!patientId && !!noteId,
    queryFn: async () => {
      const { revisions } = await fetchJson<{ revisions: EvolutionRevision[] }>(
        `/api/patients/${patientId}/evolutions/${noteId}/revisions`,
      )
      return revisions
    },
  })
}

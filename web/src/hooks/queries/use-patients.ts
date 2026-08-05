'use client'

import { useQuery } from '@tanstack/react-query'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import { queryKeys } from './query-keys'

export function usePatients(search = '', page = 1) {
  return useQuery({
    queryKey: queryKeys.patients.list(search, page),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', String(DEFAULT_PAGE_SIZE))
      const res = await fetch(`/api/patients?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar pacientes')
      }
      return res.json()
    },
  })
}

export interface PatientSearchResult {
  id: string
  fullName: string
  phone?: string | null
  cpf?: string | null
}

/**
 * Type-to-search lookup backing the SUGGEST-style patient filter (see
 * `report-filters.tsx`), reusing the same `/api/patients?search=` endpoint
 * `usePatients` already hits for the patient list page. A `<select>` with
 * every patient is unusable once a clinic has more than a handful of them
 * (the demo tenant alone has 50), so this only ever fetches a short,
 * search-matched page.
 *
 * `enabled` mirrors `usePractitioners`: callers that only sometimes show a
 * patient picker (the report filter bar, which only renders it for reports
 * that declare the `patient` filter kind) pass `enabled: false` to skip the
 * request entirely. Independently, the query never fires for a query
 * shorter than 2 characters, regardless of `enabled` — a 1-character search
 * against a clinic with thousands of patients returns a page-sized result
 * that isn't useful to show.
 */
export function usePatientSearch(search: string, { enabled = true }: { enabled?: boolean } = {}) {
  const trimmed = search.trim()
  return useQuery({
    queryKey: queryKeys.patients.search(trimmed),
    enabled: enabled && trimmed.length >= 2,
    queryFn: async (): Promise<PatientSearchResult[]> => {
      const params = new URLSearchParams({ search: trimmed, limit: '20' })
      const res = await fetch(`/api/patients?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao buscar pacientes')
      }
      const json = await res.json()
      return (json.data ?? json) as PatientSearchResult[]
    },
  })
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: queryKeys.patients.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/patients/${id}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar paciente')
      }
      return res.json()
    },
    enabled: !!id,
  })
}

export function usePatientTimeline(patientId: string | undefined) {
  return useQuery({
    queryKey: ['patients', patientId, 'timeline'],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/timeline`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar timeline')
      }
      return res.json()
    },
    enabled: !!patientId,
  })
}

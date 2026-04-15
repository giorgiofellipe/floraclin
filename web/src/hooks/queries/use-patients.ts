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

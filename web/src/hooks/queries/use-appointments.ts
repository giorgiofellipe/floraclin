'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useAppointments(
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
) {
  return useQuery({
    queryKey: queryKeys.appointments.list(practitionerId, dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (practitionerId) params.set('practitionerId', practitionerId)
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      const res = await fetch(`/api/appointments?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar agendamentos')
      }
      return res.json()
    },
  })
}

/**
 * `enabled` defaults to `true` so every existing call site (agenda,
 * planejamentos, patient detail, practitioner P&L) keeps fetching
 * unconditionally. Callers that only sometimes need the list (e.g. the
 * report filter bar, which only shows a practitioner picker for reports that
 * declare the `practitioner` filter kind) pass `enabled: false` to skip the
 * request entirely rather than fetching and discarding it.
 */
export function usePractitioners({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.appointments.practitioners,
    enabled,
    queryFn: async () => {
      const res = await fetch('/api/appointments/practitioners')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar profissionais')
      }
      return res.json()
    },
  })
}

export function useAppointmentProcedureTypes() {
  return useQuery({
    queryKey: queryKeys.appointments.procedureTypes,
    queryFn: async () => {
      const res = await fetch('/api/appointments/procedure-types')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar tipos de procedimento')
      }
      return res.json()
    },
  })
}

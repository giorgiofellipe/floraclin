'use client'

import { useQuery } from '@tanstack/react-query'
import {
  listAppointmentsAction,
  listPractitionersAction,
  listProcedureTypesForSelectAction,
} from '@/actions/appointments'
import { queryKeys } from './query-keys'

export function useAppointments(
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
) {
  return useQuery({
    queryKey: queryKeys.appointments.list(practitionerId, dateFrom, dateTo),
    queryFn: () => listAppointmentsAction(practitionerId, dateFrom, dateTo),
  })
}

export function usePractitioners() {
  return useQuery({
    queryKey: queryKeys.appointments.practitioners,
    queryFn: () => listPractitionersAction(),
  })
}

export function useAppointmentProcedureTypes() {
  return useQuery({
    queryKey: queryKeys.appointments.procedureTypes,
    queryFn: () => listProcedureTypesForSelectAction(),
  })
}

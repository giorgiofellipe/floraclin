'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { PatientAppointment } from '@/db/queries/appointments'
import type { PatientFinancialSummary } from '@/db/queries/financial'

export type { PatientAppointment, PatientFinancialSummary }

async function fetchData<T>(url: string, fallbackError: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || fallbackError)
  }
  const body = await res.json()
  return body.data as T
}

export function usePatientAppointments(patientId: string) {
  return useQuery({
    queryKey: queryKeys.appointments.byPatient(patientId),
    queryFn: () =>
      fetchData<PatientAppointment[]>(
        `/api/patients/${patientId}/appointments`,
        'Erro ao carregar agendamentos'
      ),
  })
}

export function usePatientFinancialSummary(patientId: string) {
  return useQuery({
    queryKey: queryKeys.financial.patientSummary(patientId),
    queryFn: () =>
      fetchData<PatientFinancialSummary>(
        `/api/patients/${patientId}/financial-summary`,
        'Erro ao carregar resumo financeiro'
      ),
  })
}

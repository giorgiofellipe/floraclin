'use client'

import { useQuery } from '@tanstack/react-query'
import { listPatientsAction, getPatientAction } from '@/actions/patients'
import { getPatientTimelineAction } from '@/actions/timeline'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import { queryKeys } from './query-keys'

export function usePatients(search = '', page = 1) {
  return useQuery({
    queryKey: queryKeys.patients.list(search, page),
    queryFn: () => listPatientsAction(search, page, DEFAULT_PAGE_SIZE),
  })
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: queryKeys.patients.detail(id),
    queryFn: () => getPatientAction(id),
    enabled: !!id,
  })
}

export function usePatientTimeline(patientId: string | undefined) {
  return useQuery({
    queryKey: ['patients', patientId, 'timeline'],
    queryFn: () => getPatientTimelineAction(patientId!),
    enabled: !!patientId,
  })
}

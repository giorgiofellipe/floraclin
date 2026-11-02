'use client'

import { useQuery } from '@tanstack/react-query'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'
import { queryKeys } from './query-keys'

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()).data
}

export function usePatientDiagramGroups(patientId: string) {
  return useQuery({
    queryKey: queryKeys.diagramGroups.byPatient(patientId),
    queryFn: () =>
      fetchData<DiagramGroupDetail[]>(`/api/patients/${patientId}/face-diagram-groups`),
    enabled: !!patientId,
  })
}

export function useDiagramGroup(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.diagramGroups.detail(id ?? ''),
    queryFn: () => fetchData<DiagramGroupDetail>(`/api/face-diagram-groups/${id}`),
    enabled: !!id,
  })
}

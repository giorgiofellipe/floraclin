'use client'

import { useQuery } from '@tanstack/react-query'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'
import { queryKeys } from './query-keys'

export type DiagramGroupJson = Omit<
  DiagramGroupDetail,
  'createdAt' | 'updatedAt' | 'procedurePerformedAt'
> & {
  createdAt: string
  updatedAt: string
  procedurePerformedAt: string | null
}

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()).data
}

export function usePatientDiagramGroups(patientId: string) {
  return useQuery({
    queryKey: queryKeys.diagramGroups.byPatient(patientId),
    queryFn: () =>
      fetchData<DiagramGroupJson[]>(`/api/patients/${patientId}/face-diagram-groups`),
    enabled: !!patientId,
  })
}

export function useDiagramGroup(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.diagramGroups.detail(id ?? ''),
    queryFn: () => fetchData<DiagramGroupJson>(`/api/face-diagram-groups/${id}`),
    enabled: !!id,
  })
}

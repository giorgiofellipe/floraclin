'use client'

import { useQuery } from '@tanstack/react-query'
import { listProceduresAction, getProcedureAction, getLatestNonExecutedProcedureAction } from '@/actions/procedures'
import { queryKeys } from './query-keys'

export function useProcedures(patientId: string) {
  return useQuery({
    queryKey: queryKeys.procedures.list(patientId),
    queryFn: () => listProceduresAction(patientId),
    enabled: !!patientId,
  })
}

export function useProcedure(id: string) {
  return useQuery({
    queryKey: queryKeys.procedures.detail(id),
    queryFn: () => getProcedureAction(id),
    enabled: !!id,
  })
}

export function useLatestNonExecutedProcedure(patientId: string) {
  return useQuery({
    queryKey: queryKeys.procedures.latestNonExecuted(patientId),
    queryFn: () => getLatestNonExecutedProcedureAction(patientId),
    enabled: !!patientId,
  })
}

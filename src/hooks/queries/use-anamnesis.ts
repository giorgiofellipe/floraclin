'use client'

import { useQuery } from '@tanstack/react-query'
import { getAnamnesisAction } from '@/actions/anamnesis'
import { queryKeys } from './query-keys'

export function useAnamnesis(patientId: string) {
  return useQuery({
    queryKey: queryKeys.anamnesis(patientId),
    queryFn: () => getAnamnesisAction(patientId),
    enabled: !!patientId,
  })
}

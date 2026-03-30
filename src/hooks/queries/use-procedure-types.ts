'use client'

import { useQuery } from '@tanstack/react-query'
import { listProcedureTypesAction } from '@/actions/tenants'

export function useProcedureTypes() {
  return useQuery({
    queryKey: ['procedure-types'],
    queryFn: () => listProcedureTypesAction(),
  })
}

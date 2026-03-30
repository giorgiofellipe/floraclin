'use client'

import { useQuery } from '@tanstack/react-query'
import { getDashboardDataAction } from '@/actions/dashboard'
import { queryKeys } from './query-keys'

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => getDashboardDataAction(),
  })
}

'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

/**
 * @param month Optional `YYYY-MM` month to view. Omit for the current month
 *   (default): this keeps the request identical to the pre-navigation
 *   behaviour when no month has been explicitly selected.
 */
export function useDashboard(month?: string) {
  return useQuery({
    // queryKeys.dashboard stays a plain ['dashboard'] array so existing
    // invalidateQueries({ queryKey: queryKeys.dashboard }) calls elsewhere
    // keep matching every month's cache entry via prefix matching.
    queryKey: [...queryKeys.dashboard, month ?? 'current'] as const,
    queryFn: async () => {
      const url = month ? `/api/dashboard?month=${month}` : '/api/dashboard'
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar dashboard')
      }
      return res.json()
    },
    // Keep showing the previous month's data while the next month loads,
    // instead of flashing the whole dashboard back to a loading skeleton.
    placeholderData: keepPreviousData,
  })
}

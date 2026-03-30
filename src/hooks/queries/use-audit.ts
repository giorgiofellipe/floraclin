'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

interface AuditFilters {
  entityType?: string
  entityId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

export function useAuditLogs(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: queryKeys.audit.logs(filters as Record<string, unknown>),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.entityType) params.set('entityType', filters.entityType)
      if (filters.entityId) params.set('entityId', filters.entityId)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      if (filters.page) params.set('page', String(filters.page))
      if (filters.limit) params.set('limit', String(filters.limit))
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })
}

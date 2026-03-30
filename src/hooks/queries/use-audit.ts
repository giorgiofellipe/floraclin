import { useQuery } from '@tanstack/react-query'

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
    queryKey: ['audit', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.entityType) params.set('entityType', filters.entityType)
      if (filters.entityId) params.set('entityId', filters.entityId)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      params.set('page', String(filters.page ?? 1))
      params.set('limit', String(filters.limit ?? 20))
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) throw new Error('Failed to fetch audit logs')
      return res.json()
    },
  })
}

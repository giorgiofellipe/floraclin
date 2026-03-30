'use client'

import { useQuery } from '@tanstack/react-query'
import { listAuditLogsAction } from '@/actions/audit'

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
    queryFn: () => listAuditLogsAction(filters),
  })
}

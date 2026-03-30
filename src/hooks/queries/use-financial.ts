import { useQuery } from '@tanstack/react-query'
import type { FinancialStatus } from '@/types'

interface FinancialFilters {
  patientId?: string
  status?: FinancialStatus
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

export function useFinancialEntries(filters: FinancialFilters = {}) {
  return useQuery({
    queryKey: ['financial', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.patientId) params.set('patientId', filters.patientId)
      if (filters.status) params.set('status', filters.status)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      params.set('page', String(filters.page ?? 1))
      params.set('limit', String(filters.limit ?? 20))
      const res = await fetch(`/api/financial?${params}`)
      if (!res.ok) throw new Error('Failed to fetch financial entries')
      return res.json()
    },
  })
}

export function useFinancialEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['financial', id],
    queryFn: async () => {
      const res = await fetch(`/api/financial/${id}`)
      if (!res.ok) throw new Error('Failed to fetch financial entry')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useRevenueOverview(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  return useQuery({
    queryKey: ['financial', 'overview', { dateFrom, dateTo, practitionerId }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (practitionerId) params.set('practitionerId', practitionerId)
      const res = await fetch(`/api/financial/overview?${params}`)
      if (!res.ok) throw new Error('Failed to fetch revenue overview')
      return res.json()
    },
    enabled: !!dateFrom && !!dateTo,
  })
}

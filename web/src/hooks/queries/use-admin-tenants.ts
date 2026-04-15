'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useAdminTenants(search = '', page = 1) {
  return useQuery({
    queryKey: queryKeys.admin.tenants.list(search, page),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', '20')
      const res = await fetch(`/api/admin/tenants?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar tenants')
      }
      return res.json()
    },
  })
}

export function useAdminTenantDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.admin.tenants.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/admin/tenants/${id}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar tenant')
      }
      return res.json()
    },
    enabled: !!id,
  })
}

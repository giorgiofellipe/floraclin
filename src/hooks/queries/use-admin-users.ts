'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useAdminUsers(search = '', page = 1) {
  return useQuery({
    queryKey: queryKeys.admin.users.list(search, page),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', '20')
      const res = await fetch(`/api/admin/users?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar usuários')
      }
      return res.json()
    },
  })
}

export function useAdminUserDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.admin.users.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${id}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar usuário')
      }
      return res.json()
    },
    enabled: !!id,
  })
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useAdminSubscriptions(status?: string, plan?: string, search?: string) {
  return useQuery({
    queryKey: queryKeys.admin.subscriptions.list(status, plan, search),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (plan) params.set('plan', plan)
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/subscriptions?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar assinaturas')
      }
      return res.json()
    },
  })
}

export function useAdminSubscriptionDetail(tenantId: string) {
  return useQuery({
    queryKey: queryKeys.admin.subscriptions.detail(tenantId),
    queryFn: async () => {
      const res = await fetch(`/api/admin/subscriptions/${tenantId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar assinatura')
      }
      return res.json()
    },
    enabled: !!tenantId,
  })
}

export function useAdminPlans() {
  return useQuery({
    queryKey: queryKeys.admin.plans,
    queryFn: async () => {
      const res = await fetch('/api/billing/plans')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar planos')
      }
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

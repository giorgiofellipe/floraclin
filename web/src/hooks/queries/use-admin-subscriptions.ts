'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { AdminFeedbackDiscount, FeedbackEligibilityRow } from '@/lib/feedback-eligibility'

/** The fields of the admin subscription GET the detail dialog reads. */
export interface AdminSubscriptionDetail extends FeedbackEligibilityRow {
  creditUsage?: { used?: number; total?: number } | null
  stripeState?: string | null
  feedbackDiscount: AdminFeedbackDiscount | null
}

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
      return res.json() as Promise<{ data: AdminSubscriptionDetail }>
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

'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReferralDashboardResponse } from '@/lib/referral/dashboard'
import { queryKeys } from './query-keys'

/** null when the clinic has no Indique e Ganhe dashboard (program off, or not the owner). */
export function useReferralDashboard({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ReferralDashboardResponse | null>({
    queryKey: queryKeys.referral,
    enabled,
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/referral')
      if (res.status === 403 || res.status === 404) return null
      if (!res.ok) throw new Error('Erro ao carregar indicações')
      return res.json()
    },
  })
}

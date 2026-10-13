'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import { ApiError } from '@/hooks/mutations/use-financial-mutations'
import type { InstallmentQuoteResult } from '@/db/queries/financial-quote'

export function useInstallmentQuote(installmentId: string, paidAt?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.financial.installmentQuote(installmentId, paidAt),
    enabled,
    queryFn: async (): Promise<InstallmentQuoteResult> => {
      const url = paidAt
        ? `/api/financial/installments/${installmentId}/quote?paidAt=${encodeURIComponent(paidAt)}`
        : `/api/financial/installments/${installmentId}/quote`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new ApiError(body.error || `HTTP ${res.status}`, body.code)
      }
      return (await res.json()).data
    },
  })
}

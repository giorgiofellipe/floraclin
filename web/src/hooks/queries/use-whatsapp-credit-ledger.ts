'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { LedgerPage } from '@/lib/whatsapp-credit-ledger'

async function fetchLedgerPage(periodId: string | null, cursor: string | null): Promise<LedgerPage> {
  const params = new URLSearchParams()
  if (periodId) params.set('periodId', periodId)
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`/api/whatsapp/credits/ledger?${params}`)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useWhatsAppCreditLedger(periodId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.whatsappCredits.ledger(periodId),
    queryFn: ({ pageParam }) => fetchLedgerPage(periodId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

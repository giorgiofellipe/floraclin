'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type {
  ImportPreview,
  ImportResult,
  MatchCandidate,
  StatementLine,
  StatementLineFilter,
} from '@/db/queries/bank-reconciliation'
import type { AllocateInput } from '@/validations/bank-reconciliation'

// Dates arrive as ISO strings over JSON.
export type StatementLineView = Omit<StatementLine, 'ignoredAt' | 'suspectReviewedAt' | 'allocations'> & {
  ignoredAt: string | null
  suspectReviewedAt: string | null
  allocations: Array<{ id: string; movementId: string; amountCents: number; description: string; movementDate: string }>
}
export type MatchCandidateView = Omit<MatchCandidate, 'movementDate'> & { movementDate: string }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code })
  return body.data as T
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

function useInvalidateFinance() {
  const queryClient = useQueryClient()
  // Matching changes lines and candidates; creating an expense also changes the ledger and balances.
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
}

export function useStatementLines(accountId: string, status: StatementLineFilter, offset = 0) {
  return useQuery({
    queryKey: queryKeys.financial.reconciliationLines(accountId, status, offset),
    enabled: Boolean(accountId),
    queryFn: () =>
      request<{ lines: StatementLineView[]; hasMore: boolean }>(
        `/api/financial/reconciliation/lines?accountId=${accountId}&status=${status}&offset=${offset}`,
      ),
  })
}

export function useMatchCandidates(lineId: string | null, search: string) {
  return useQuery({
    queryKey: queryKeys.financial.reconciliationCandidates(lineId ?? '', search),
    enabled: Boolean(lineId),
    queryFn: () =>
      request<{ candidates: MatchCandidateView[]; remainingCents: number }>(
        `/api/financial/reconciliation/lines/${lineId}/candidates?search=${encodeURIComponent(search)}`,
      ),
  })
}

function uploadBody(accountId: string, file: File) {
  const form = new FormData()
  form.set('accountId', accountId)
  form.set('file', file)
  return { method: 'POST', body: form }
}

export function usePreviewStatementImport() {
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) =>
      request<ImportPreview>('/api/financial/reconciliation/imports/preview', uploadBody(accountId, file)),
  })
}

export function useCommitStatementImport() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) =>
      request<ImportResult>('/api/financial/reconciliation/imports', uploadBody(accountId, file)),
    onSuccess: invalidate,
  })
}

export function useAllocateLine() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ lineId, ...data }: AllocateInput & { lineId: string }) =>
      request(`/api/financial/reconciliation/lines/${lineId}/allocations`, json('POST', data)),
    onSuccess: invalidate,
  })
}

export function useUndoMatch() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ lineId, allocationId }: { lineId: string; allocationId?: string }) =>
      request(
        `/api/financial/reconciliation/lines/${lineId}/allocations${allocationId ? `?allocationId=${allocationId}` : ''}`,
        { method: 'DELETE' },
      ),
    onSuccess: invalidate,
  })
}

export function useIgnoreLine() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) =>
      request(`/api/financial/reconciliation/lines/${lineId}/ignore`, json('POST', { reason })),
    onSuccess: invalidate,
  })
}

export function useUnignoreLine() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: (lineId: string) => request(`/api/financial/reconciliation/lines/${lineId}/ignore`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useConfirmDistinctLine() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: (lineId: string) => request(`/api/financial/reconciliation/lines/${lineId}/review-duplicate`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export function useCreateExpenseFromLine() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ lineId, ...data }: { lineId: string; categoryId: string; description?: string; paymentMethod: string }) =>
      request<{ expenseId: string; reused: boolean }>(`/api/financial/reconciliation/lines/${lineId}/expense`, json('POST', data)),
    onSuccess: invalidate,
  })
}

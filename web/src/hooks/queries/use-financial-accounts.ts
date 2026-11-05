'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { FinancialAccountKind } from '@/db/schema'
import type {
  CreateFinancialAccountInput,
  TransferInput,
  UpdateFinancialAccountInput,
} from '@/validations/financial-accounts'

export interface FinancialAccount {
  id: string
  kind: FinancialAccountKind
  name: string
  bankName: string | null
  bankAgency: string | null
  bankAccount: string | null
  isDefault: boolean
  openingBalanceDate: string | null
  archivedAt: string | null
  /** Only for the roles that manage accounts. */
  openingBalance?: string
  balance?: number
}

async function requestJson(url: string, method: string, data?: unknown) {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useFinancialAccounts({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.financial.accounts(includeArchived),
    queryFn: (): Promise<{ data: FinancialAccount[]; canManage: boolean }> =>
      requestJson(`/api/financial/accounts${includeArchived ? '?includeArchived=true' : ''}`, 'GET'),
  })
}

// Balances, the ledger and terminals' payout choices all read accounts.
function useInvalidateFinance() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
}

export function useCreateFinancialAccount() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: (data: CreateFinancialAccountInput): Promise<{ data: FinancialAccount }> =>
      requestJson('/api/financial/accounts', 'POST', data),
    onSuccess: invalidate,
  })
}

export function useUpdateFinancialAccount() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateFinancialAccountInput & { id: string }) =>
      requestJson(`/api/financial/accounts/${id}`, 'PATCH', data),
    onSuccess: invalidate,
  })
}

export function useSetFinancialAccountArchived() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      requestJson(`/api/financial/accounts/${id}`, 'PUT', { archived }),
    onSuccess: invalidate,
  })
}

export function useCreateTransfer() {
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: (data: TransferInput) => requestJson('/api/financial/transfers', 'POST', data),
    onSuccess: invalidate,
  })
}

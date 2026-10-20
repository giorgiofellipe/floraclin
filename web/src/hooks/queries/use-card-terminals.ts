'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { CardTerminalRow } from '@/db/queries/card-terminals'
import type { CardTerminalInput } from '@/validations/card-terminals'

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

export function useCardTerminals() {
  return useQuery({
    queryKey: queryKeys.financial.cardTerminals,
    queryFn: (): Promise<{ data: CardTerminalRow[]; canManage: boolean }> =>
      requestJson('/api/financial/card-terminals', 'GET'),
  })
}

function useInvalidateTerminals() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.financial.cardTerminals })
}

export function useCreateCardTerminal() {
  const invalidate = useInvalidateTerminals()
  return useMutation({
    mutationFn: (data: CardTerminalInput): Promise<{ success: true; data: CardTerminalRow }> =>
      requestJson('/api/financial/card-terminals', 'POST', data),
    onSuccess: invalidate,
  })
}

export function useUpdateCardTerminal() {
  const invalidate = useInvalidateTerminals()
  return useMutation({
    mutationFn: ({ id, ...data }: CardTerminalInput & { id: string }) =>
      requestJson(`/api/financial/card-terminals/${id}`, 'PATCH', data),
    onSuccess: invalidate,
  })
}

export function useDeleteCardTerminal() {
  const invalidate = useInvalidateTerminals()
  return useMutation({
    mutationFn: (id: string) => requestJson(`/api/financial/card-terminals/${id}`, 'DELETE'),
    onSuccess: invalidate,
  })
}

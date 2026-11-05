'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NfseAddress, NfseCancelReason, NfseCompetenceChoice, NfseProcessResult } from '@/lib/nfse/types'
import type { NfseAddressSource, NfseTakerField } from '@/lib/nfse/taker-address'
import { queryKeys } from './query-keys'
import { NfseApiError } from './use-nfse-settings'

export interface NfsePreviewPatient {
  patientId: string
  patientName: string
  paymentRecordIds: string[]
  total: number
  missing: NfseTakerField[]
  addressSource: NfseAddressSource
  current: Record<'cpf' | 'zip' | 'street' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state', string> | null
  email: string | null
  canEditTaker: boolean
}

export interface NfsePreview {
  patients: NfsePreviewPatient[]
  defaultCompetence: string
  competenceIsPastMonth: boolean
  settings: { emailPatient: boolean }
}

export interface NfseTakerInput {
  patientId: string
  cpf: string
  address?: NfseAddress
}

async function request<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new NfseApiError(body.error || fallback, body.code, body.fieldErrors)
  return body as T
}

function postJson(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export function useNfseStatus() {
  return useQuery({
    queryKey: queryKeys.nfse.status,
    queryFn: async () =>
      (
        await request<{ data: { configured: boolean; canEmit: boolean; canCancel: boolean } }>(
          '/api/nfse/status',
          undefined,
          'Erro ao carregar a configuração da NFS-e',
        )
      ).data,
    retry: false,
  })
}

export function useNfsePreview(paymentRecordIds: string[], enabled = true) {
  return useQuery({
    queryKey: queryKeys.nfse.preview(paymentRecordIds),
    queryFn: async () =>
      (
        await request<{ data: NfsePreview }>(
          `/api/nfse?paymentRecordIds=${paymentRecordIds.join(',')}`,
          undefined,
          'Erro ao carregar os dados da NFS-e',
        )
      ).data,
    enabled: enabled && paymentRecordIds.length > 0,
    gcTime: 0,
  })
}

function useInvalidateFinancial() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.financial.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.nfse.all })
  }
}

export function useEmitNfse() {
  const invalidate = useInvalidateFinancial()
  return useMutation({
    mutationFn: async (input: {
      paymentRecordIds: string[]
      competence: NfseCompetenceChoice
      sendEmail: boolean
      takers?: NfseTakerInput[]
    }) =>
      (await request<{ data: NfseProcessResult[] }>('/api/nfse', postJson(input), 'Erro ao emitir a NFS-e')).data,
    onSettled: invalidate,
  })
}

export function useCancelNfse() {
  const invalidate = useInvalidateFinancial()
  return useMutation({
    mutationFn: async ({
      documentId,
      ...input
    }: {
      documentId: string
      reason: NfseCancelReason
      justification: string
    }) =>
      (
        await request<{ data: { id: string; status: string; cancelRequested: boolean; errorMessage: string | null } }>(
          `/api/nfse/${documentId}/cancel`,
          postJson(input),
          'Erro ao cancelar a NFS-e',
        )
      ).data,
    onSettled: invalidate,
  })
}

export function useResendNfseEmail() {
  const invalidate = useInvalidateFinancial()
  return useMutation({
    mutationFn: async (documentId: string) =>
      (
        await request<{ data: { id: string; emailSentAt: string | null } }>(
          `/api/nfse/${documentId}/email`,
          { method: 'POST' },
          'Erro ao reenviar o email',
        )
      ).data,
    onSettled: invalidate,
  })
}

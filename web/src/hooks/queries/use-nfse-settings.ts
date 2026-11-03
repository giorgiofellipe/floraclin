'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  NfseCertificateInfo,
  NfseFiscalSettingsInput,
  NfseSettingsPublic,
} from '@/lib/nfse/types'
import { queryKeys } from './query-keys'

export class NfseApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[] | undefined>,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new NfseApiError(body.error || fallback, body.code, body.fieldErrors)
  return body as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export function useNfseCertificate() {
  return useQuery({
    queryKey: queryKeys.nfse.certificate,
    queryFn: async () =>
      (
        await request<{ data: NfseCertificateInfo | null }>(
          '/api/nfse/certificate',
          undefined,
          'Erro ao carregar o certificado',
        )
      ).data,
  })
}

export function useSaveNfseCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { pfxBase64: string; password: string }) =>
      (
        await request<{ data: NfseCertificateInfo }>(
          '/api/nfse/certificate',
          jsonInit('PUT', input),
          'Erro ao salvar o certificado',
        )
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.nfse.all }),
  })
}

export function useDeleteNfseCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<{ success: true }>('/api/nfse/certificate', { method: 'DELETE' }, 'Erro ao remover o certificado'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.nfse.all }),
  })
}

export function useNfseSettings() {
  return useQuery({
    queryKey: queryKeys.nfse.settings,
    queryFn: () =>
      request<{ data: NfseSettingsPublic | null; suggestedMunicipalityCode: string | null }>(
        '/api/nfse/settings',
        undefined,
        'Erro ao carregar as configurações de nota fiscal',
      ),
  })
}

export function useSaveNfseSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NfseFiscalSettingsInput) =>
      request<{ data: NfseSettingsPublic }>(
        '/api/nfse/settings',
        jsonInit('PUT', input),
        'Erro ao salvar as configurações de nota fiscal',
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.nfse.all }),
  })
}

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

async function mutateJson(url: string, method: string, data?: unknown) {
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

export function useCreateConsentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/consent/templates', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consent.templates })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.consentTemplates })
    },
  })
}

export function useUpdateConsentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      mutateJson(`/api/consent/templates/${id}`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consent.templates })
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.consentTemplates })
    },
  })
}

export function useAcceptConsent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => mutateJson('/api/consent/accept', 'POST', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consent.all })
      if (variables.patientId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.consent.history(variables.patientId as string) })
      }
    },
  })
}

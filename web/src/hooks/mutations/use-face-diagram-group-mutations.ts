'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import type {
  createDiagramGroupSchema,
  updateDiagramGroupSchema,
} from '@/validations/face-diagram-group'
import { queryKeys } from '../queries/query-keys'

async function mutateJson(url: string, method: string, data: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function postJson<T>(url: string, fallbackError: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST' })
  } catch {
    throw new Error(`${fallbackError}. Verifique sua conexão e tente novamente.`)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || fallbackError)
  return json.data
}

function useInvalidateGroups() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.diagramGroups.all }),
      queryClient.invalidateQueries({ queryKey: ['planejamentos'] }),
    ])
}

function useInvalidateQuotes() {
  const queryClient = useQueryClient()
  const invalidateGroups = useInvalidateGroups()
  return (patientId: string) =>
    Promise.all([
      invalidateGroups(),
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.timeline(patientId) }),
    ])
}

export function useCreateDiagramGroup() {
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({
      patientId,
      ...body
    }: { patientId: string } & z.input<typeof createDiagramGroupSchema>) =>
      mutateJson(`/api/patients/${patientId}/face-diagram-groups`, 'POST', body) as Promise<{
        data: { id: string }
      }>,
    onSuccess: invalidate,
  })
}

export function useUpdateDiagramGroup() {
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & z.input<typeof updateDiagramGroupSchema>) =>
      mutateJson(`/api/face-diagram-groups/${id}`, 'PUT', body),
    onSuccess: invalidate,
  })
}

export function useGenerateDiagramQuote() {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: ({ groupId }: { groupId: string; patientId: string }) =>
      postJson<{ id: string; url: string }>(
        `/api/face-diagram-groups/${groupId}/quotes`,
        'Falha ao gerar orçamento',
      ),
    onSuccess: (_data, { patientId }) => invalidate(patientId),
  })
}

export function useSendDiagramQuoteWhatsapp() {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: ({ quoteId }: { quoteId: string; patientId: string }) =>
      postJson<{ queued?: boolean } | undefined>(
        `/api/face-diagram-quotes/${quoteId}/send-whatsapp`,
        'Falha ao enviar via WhatsApp',
      ),
    onSuccess: (_data, { patientId }) => invalidate(patientId),
  })
}

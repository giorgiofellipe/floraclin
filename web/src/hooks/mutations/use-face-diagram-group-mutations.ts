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

function useInvalidateGroups() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.diagramGroups.all }),
      queryClient.invalidateQueries({ queryKey: ['planejamentos'] }),
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

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

export function useUpsertAnamnesis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ patientId, formData, expectedUpdatedAt }: {
      patientId: string
      formData: Record<string, unknown>
      expectedUpdatedAt?: string
    }) => {
      const res = await fetch(`/api/anamnesis/${patientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData, expectedUpdatedAt }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.anamnesis(variables.patientId) })
    },
  })
}

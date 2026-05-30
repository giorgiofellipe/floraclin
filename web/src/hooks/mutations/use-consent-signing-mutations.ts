'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

export function useSendSigningLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      patientId: string
      procedureRecordId: string
      consentTypes: string[]
    }) => {
      const res = await fetch('/api/consent/send-signing-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consent.all })
    },
  })
}

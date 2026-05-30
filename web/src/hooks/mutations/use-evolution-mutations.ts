'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EvolutionNote } from '@/db/queries/patient-evolutions'
import { evolutionsKeys } from '@/hooks/queries/use-evolutions'

interface CreateEvolutionVars {
  body: string
  occurredAt?: string
}

interface EditEvolutionVars {
  noteId: string
  body: string
  occurredAt?: string
}

interface DeleteEvolutionVars {
  noteId: string
  reason: string
}

async function readJsonError(res: Response): Promise<never> {
  // The server returns `{ error: string }` on validation / business errors.
  // Fall back to a generic HTTP status string if the body isn't parseable.
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  throw new Error(json?.error || `HTTP ${res.status}`)
}

export function useCreateEvolution(patientId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ note: EvolutionNote }, Error, CreateEvolutionVars>({
    mutationFn: async ({ body, occurredAt }) => {
      const res = await fetch(`/api/patients/${patientId}/evolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, occurredAt }),
      })
      if (!res.ok) await readJsonError(res)
      return res.json() as Promise<{ note: EvolutionNote }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evolutionsKeys.feed(patientId) })
    },
  })
}

export function useEditEvolution(patientId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ note: EvolutionNote }, Error, EditEvolutionVars>({
    mutationFn: async ({ noteId, body, occurredAt }) => {
      const res = await fetch(
        `/api/patients/${patientId}/evolutions/${noteId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, occurredAt }),
        },
      )
      if (!res.ok) await readJsonError(res)
      return res.json() as Promise<{ note: EvolutionNote }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: evolutionsKeys.feed(patientId) })
      queryClient.invalidateQueries({
        queryKey: evolutionsKeys.revisions(patientId, variables.noteId),
      })
    },
  })
}

export function useDeleteEvolution(patientId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, DeleteEvolutionVars>({
    mutationFn: async ({ noteId, reason }) => {
      const res = await fetch(
        `/api/patients/${patientId}/evolutions/${noteId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      )
      // DELETE returns 204 with an empty body — do NOT try to parse JSON.
      if (!res.ok) await readJsonError(res)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evolutionsKeys.feed(patientId) })
    },
  })
}

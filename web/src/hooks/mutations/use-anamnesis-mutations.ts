'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormResponses, FormSection } from '@/lib/forms/types'
import type { AnamnesisTemplate } from '@/lib/anamnesis/types'
import { queryKeys } from '../queries/query-keys'
import { throwIfNotOk } from '../throw-if-not-ok'

export class AnamnesisSaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: 'stale' | 'template_changed',
  ) {
    super(message)
  }
}

export interface UpsertAnamnesisInput {
  patientId: string
  templateVersion: number
  responses: FormResponses
  expectedUpdatedAt?: string
  expectNoRow?: boolean
  applyCurrentTemplate?: boolean
}

export interface UpsertAnamnesisResult {
  success: true
  data: {
    id: string
    updatedAt: string
    updatedBy: string | null
    templateVersion: number
    templateSnapshot: FormSection[]
  }
}

export function useUpsertAnamnesis() {
  const queryClient = useQueryClient()
  return useMutation<UpsertAnamnesisResult, AnamnesisSaveError, UpsertAnamnesisInput>({
    mutationFn: async ({ patientId, ...body }) => {
      const res = await fetch(`/api/anamnesis/${patientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await throwIfNotOk(
        res,
        (message, status, code) => new AnamnesisSaveError(message, status, code as AnamnesisSaveError['code']),
      )
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.anamnesis(variables.patientId) })
    },
  })
}

export type SaveAnamnesisTemplateInput =
  | { action: 'update'; sections: FormSection[] }
  | { action: 'reset' }

export function useSaveAnamnesisTemplate() {
  const queryClient = useQueryClient()
  return useMutation<{ success: true; data: AnamnesisTemplate }, Error, SaveAnamnesisTemplateInput>({
    mutationFn: async (input) => {
      const res = await fetch('/api/anamnesis/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      await throwIfNotOk(res)
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.anamnesisTemplate }),
  })
}

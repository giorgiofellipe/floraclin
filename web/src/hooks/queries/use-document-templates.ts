'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ClinicalDocumentKind,
  ClinicalDocumentTemplateInput,
  UpdateClinicalDocumentTemplateInput,
} from '@/validations/clinical-document'

export interface DocumentTemplateRow {
  id: string
  tenantId: string
  kind: ClinicalDocumentKind
  name: string
  body: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const templatesKey = (kind?: ClinicalDocumentKind, includeInactive?: boolean) =>
  ['document-templates', kind ?? 'all', includeInactive ? 'with-inactive' : 'active'] as const

export function useDocumentTemplates(args?: {
  kind?: ClinicalDocumentKind
  includeInactive?: boolean
}) {
  return useQuery({
    queryKey: templatesKey(args?.kind, args?.includeInactive),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (args?.kind) params.set('kind', args.kind)
      if (args?.includeInactive) params.set('includeInactive', 'true')
      const qs = params.toString()
      const res = await fetchJson<{ data: DocumentTemplateRow[] }>(
        `/api/document-templates${qs ? `?${qs}` : ''}`,
      )
      return res.data
    },
  })
}

export function useCreateDocumentTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ClinicalDocumentTemplateInput) =>
      fetchJson<{ data: DocumentTemplateRow }>('/api/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
    },
  })
}

export function useUpdateDocumentTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateClinicalDocumentTemplateInput }) =>
      fetchJson<{ data: DocumentTemplateRow }>(`/api/document-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
    },
  })
}

export function useDeleteDocumentTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: true }>(`/api/document-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
    },
  })
}

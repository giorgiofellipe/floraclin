'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { IssueClinicalDocumentInput } from '@/validations/clinical-document'

export interface PatientDocumentRow {
  id: string
  kind: 'receita' | 'atestado'
  title: string
  issuedAt: string
  deliveredVia: string
  practitionerId: string
  practitionerName: string
  templateId: string | null
  whatsappMessageId: string | null
  storagePath: string | null
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const patientDocumentsKey = (patientId: string) =>
  ['clinical-documents', 'patient', patientId] as const

export function usePatientDocuments(patientId: string) {
  return useQuery({
    queryKey: patientDocumentsKey(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const res = await fetchJson<{ data: PatientDocumentRow[] }>(
        `/api/patients/${patientId}/documents`,
      )
      return res.data
    },
  })
}

export function useIssueClinicalDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IssueClinicalDocumentInput) =>
      fetchJson<{ data: { id: string } }>('/api/clinical-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: patientDocumentsKey(variables.patientId) })
    },
  })
}

export function useSendDocumentWhatsapp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; patientId?: string }) =>
      fetchJson<{
        success: true
        data: { deliveredVia: string; whatsappMessageId: string | null }
      }>(`/api/clinical-documents/${id}/send-whatsapp`, { method: 'POST' }),
    onSuccess: (_data, variables) => {
      if (variables.patientId) {
        qc.invalidateQueries({ queryKey: patientDocumentsKey(variables.patientId) })
      } else {
        qc.invalidateQueries({ queryKey: ['clinical-documents'] })
      }
    },
  })
}

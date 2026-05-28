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

export interface ClinicalDocumentDetail {
  id: string
  tenantId: string
  patientId: string
  practitionerId: string
  kind: 'receita' | 'atestado'
  title: string
  body: string
  templateId: string | null
  professionalSnapshot: {
    name: string
    registryLine: string
    signatureDataUrl: string
  }
  issuedAt: string
  deliveredVia: string
  whatsappMessageId: string | null
  storagePath: string | null
  createdAt: string
  updatedAt: string
  patient: {
    id: string
    fullName: string
    cpf: string | null
    birthDate: string | null
    phone: string
  }
  tenant: {
    id: string
    name: string
    phone: string | null
    email: string | null
    logoUrl: string | null
    address: Record<string, unknown> | null
  }
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

const documentDetailKey = (id: string) =>
  ['clinical-documents', 'detail', id] as const

export function useClinicalDocument(id: string | null | undefined) {
  return useQuery({
    queryKey: documentDetailKey(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const res = await fetchJson<{ data: ClinicalDocumentDetail }>(
        `/api/clinical-documents/${id}`,
      )
      return res.data
    },
  })
}

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
      qc.invalidateQueries({ queryKey: documentDetailKey(variables.id) })
      if (variables.patientId) {
        qc.invalidateQueries({ queryKey: patientDocumentsKey(variables.patientId) })
      } else {
        qc.invalidateQueries({ queryKey: ['clinical-documents'] })
      }
    },
  })
}

/**
 * Records a non-WhatsApp delivery event (print or PDF download) by PATCHing the
 * delivery endpoint. The UI should call this immediately before opening the
 * print page or PDF URL so the state machine reflects what the user actually
 * did. Returns void on success — callers should not block UX on the response;
 * fire-and-forget is fine if you also wrap in a try/catch to swallow network
 * blips (still opening the URL is more important than the audit blip).
 */
export function useMarkDocumentDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      channel,
    }: {
      id: string
      channel: 'print' | 'download'
      patientId?: string
    }) =>
      fetchJson<{ success: true; data: { deliveredVia: string } }>(
        `/api/clinical-documents/${id}/delivery`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel }),
        },
      ),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentDetailKey(variables.id) })
      if (variables.patientId) {
        qc.invalidateQueries({ queryKey: patientDocumentsKey(variables.patientId) })
      } else {
        qc.invalidateQueries({ queryKey: ['clinical-documents'] })
      }
    },
  })
}

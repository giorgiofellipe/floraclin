'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  PackageTemplate as DbPackageTemplate,
  PackageTemplateLine as DbPackageTemplateLine,
  PatientPackageRecordWithConsumption as DbPatientPackageRecordWithConsumption,
  PatientPackageWithConsumption as DbPatientPackageWithConsumption,
} from '@/db/queries/packages'
import type { ClosePackageFormValues } from '@/validations/encerrar-pacote'

// ─── Types ──────────────────────────────────────────────────────────

export type PackageTemplateLine = DbPackageTemplateLine
export type PackageTemplate = DbPackageTemplate
export type PatientPackageRecordWithConsumption = DbPatientPackageRecordWithConsumption
export type PatientPackageWithConsumption = DbPatientPackageWithConsumption

export interface PackageTemplatePayload {
  name: string
  description?: string | null
  defaultPrice?: number | null
  validityMonths?: number | null
  lines: Array<{
    procedureTypeId: string
    sessionsCount: number
    sortOrder?: number
  }>
}

export interface UpdatePackageTemplatePayload extends Partial<PackageTemplatePayload> {
  isActive?: boolean
}

// ─── Query keys ─────────────────────────────────────────────────────

export const packageQueryKeys = {
  all: ['packages'] as const,
  templates: ['packages', 'templates'] as const,
  patientPackages: (patientId: string) =>
    ['packages', 'patient', patientId] as const,
}

// ─── JSON helper ────────────────────────────────────────────────────

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

// ─── Queries ────────────────────────────────────────────────────────

export function usePackageTemplates() {
  return useQuery<PackageTemplate[]>({
    queryKey: packageQueryKeys.templates,
    queryFn: async () => {
      const res = await fetch('/api/package-templates')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar modelos de pacote')
      }
      return res.json()
    },
  })
}

export function usePatientPackages(patientId: string) {
  return useQuery<PatientPackageWithConsumption[]>({
    queryKey: packageQueryKeys.patientPackages(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/packages`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar pacotes do paciente')
      }
      return res.json()
    },
  })
}

// ─── Mutations ──────────────────────────────────────────────────────

export function useCreatePackageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PackageTemplatePayload) =>
      mutateJson('/api/package-templates', 'POST', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.templates })
    },
  })
}

export function useUpdatePackageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdatePackageTemplatePayload) =>
      mutateJson(`/api/package-templates/${id}`, 'PATCH', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.templates })
    },
  })
}

export function useDeletePackageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mutateJson(`/api/package-templates/${id}`, 'DELETE'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.templates })
    },
  })
}

export function useCancelPackage(patientId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      mutateJson(`/api/patient-packages/${id}/cancel`, 'POST', { reason }),
    onSuccess: () => {
      if (patientId) {
        qc.invalidateQueries({
          queryKey: packageQueryKeys.patientPackages(patientId),
        })
      } else {
        qc.invalidateQueries({ queryKey: packageQueryKeys.all })
      }
    },
  })
}

export function useClosePackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ packageId, body }: { packageId: string; body: ClosePackageFormValues }) => {
      const res = await fetch(`/api/patient-packages/${packageId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Falha ao encerrar pacote')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-packages'] })
    },
  })
}

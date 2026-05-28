'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ─── Types ──────────────────────────────────────────────────────────

export interface PackageTemplateLine {
  id: string
  templateId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsCount: number
  sortOrder: number
}

export interface PackageTemplate {
  id: string
  tenantId: string
  name: string
  description: string | null
  defaultPrice: string | null
  validityMonths: number | null
  isActive: boolean
  createdAt: string | Date
  updatedAt: string | Date
  deletedAt: string | Date | null
  lines: PackageTemplateLine[]
}

export interface PatientPackageLineWithConsumption {
  id: string
  patientPackageId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsTotal: number
  sortOrder: number
  consumedCount: number
  executedCount: number
}

export interface PatientPackageWithConsumption {
  id: string
  tenantId: string
  patientId: string
  templateId: string | null
  name: string
  totalAmount: string
  purchasedAt: string
  expiresAt: string | null
  status: string
  cancelledAt: string | Date | null
  cancelReason: string | null
  financialEntryId: string
  soldBy: string
  createdAt: string | Date
  updatedAt: string | Date
  lines: PatientPackageLineWithConsumption[]
}

export interface SellPackagePayload {
  patientId: string
  templateId: string | null
  name: string
  totalAmount: number
  validityMonths?: number | null
  lines: Array<{
    procedureTypeId: string
    procedureTypeName: string
    sessionsTotal: number
  }>
  paymentMethod: 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'
  installmentCount: number
}

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

export function useSellPackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SellPackagePayload) =>
      mutateJson('/api/patient-packages', 'POST', data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: packageQueryKeys.patientPackages(variables.patientId),
      })
      qc.invalidateQueries({ queryKey: ['financial'] })
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

export function useStartPackageSession(patientId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      patientPackageId,
      patientPackageLineId,
      allowExpiredOverride,
    }: {
      patientPackageId: string
      patientPackageLineId: string
      allowExpiredOverride?: boolean
    }) => {
      const res = await mutateJson(
        `/api/patient-packages/${patientPackageId}/lines/${patientPackageLineId}/start-session`,
        'POST',
        allowExpiredOverride ? { allowExpiredOverride: true } : {},
      )
      return res as { success: true; data: { procedureRecordId: string } }
    },
    onSuccess: () => {
      if (patientId) {
        qc.invalidateQueries({
          queryKey: packageQueryKeys.patientPackages(patientId),
        })
      } else {
        qc.invalidateQueries({ queryKey: packageQueryKeys.all })
      }
      qc.invalidateQueries({ queryKey: ['procedures'] })
    },
  })
}

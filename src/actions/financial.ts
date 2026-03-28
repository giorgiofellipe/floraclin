'use server'

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  createFinancialEntrySchema,
  payInstallmentSchema,
  financialFilterSchema,
  revenueFilterSchema,
} from '@/validations/financial'
import {
  createFinancialEntry,
  listFinancialEntries,
  getFinancialEntry,
  payInstallment,
  getRevenueOverview,
} from '@/db/queries/financial'
import type { PaymentMethod } from '@/types'

export type FinancialActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  data?: unknown
} | null

export async function createFinancialEntryAction(
  _prevState: FinancialActionState,
  formData: FormData
): Promise<FinancialActionState> {
  try {
    const context = await requireRole('owner', 'receptionist', 'financial')

    const raw = {
      patientId: formData.get('patientId') as string,
      procedureRecordId: (formData.get('procedureRecordId') as string) || undefined,
      appointmentId: (formData.get('appointmentId') as string) || undefined,
      description: formData.get('description') as string,
      totalAmount: Number(formData.get('totalAmount')),
      installmentCount: Number(formData.get('installmentCount')),
      notes: (formData.get('notes') as string) || undefined,
    }

    const parsed = createFinancialEntrySchema.safeParse(raw)
    if (!parsed.success) {
      return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const entry = await createFinancialEntry(context.tenantId, context.userId, parsed.data)

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'create',
      entityType: 'financial_entry',
      entityId: entry.id,
    })

    return { success: true, data: entry }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao criar cobrança' }
  }
}

export async function listFinancialEntriesAction(filters: {
  patientId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  try {
    const context = await requireRole('owner', 'receptionist', 'financial', 'practitioner')

    const parsed = financialFilterSchema.safeParse(filters)
    if (!parsed.success) {
      return { error: 'Filtros inválidos', data: null }
    }

    const result = await listFinancialEntries(context.tenantId, parsed.data)
    return { data: result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao listar cobranças', data: null }
  }
}

export async function getFinancialEntryAction(entryId: string) {
  try {
    const context = await requireRole('owner', 'receptionist', 'financial', 'practitioner')

    const entry = await getFinancialEntry(context.tenantId, entryId)
    if (!entry) {
      return { error: 'Cobrança não encontrada', data: null }
    }

    return { data: entry }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao buscar cobrança', data: null }
  }
}

export async function payInstallmentAction(
  installmentId: string,
  paymentMethod: PaymentMethod
): Promise<FinancialActionState> {
  try {
    const context = await requireRole('owner', 'receptionist', 'financial')

    const parsed = payInstallmentSchema.safeParse({ installmentId, paymentMethod })
    if (!parsed.success) {
      return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const installment = await payInstallment(
      context.tenantId,
      parsed.data.installmentId,
      parsed.data.paymentMethod as PaymentMethod
    )

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'update',
      entityType: 'installment',
      entityId: installment.id,
      changes: {
        status: { old: 'pending', new: 'paid' },
        paymentMethod: { old: null, new: paymentMethod },
      },
    })

    return { success: true, data: installment }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao registrar pagamento' }
  }
}

export async function getRevenueOverviewAction(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  try {
    const context = await requireRole('owner', 'financial')

    const parsed = revenueFilterSchema.safeParse({ dateFrom, dateTo, practitionerId })
    if (!parsed.success) {
      return { error: 'Filtros inválidos', data: null }
    }

    const overview = await getRevenueOverview(
      context.tenantId,
      parsed.data.dateFrom,
      parsed.data.dateTo,
      parsed.data.practitionerId
    )

    return { data: overview }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao buscar visão geral', data: null }
  }
}

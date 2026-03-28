'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getTenant,
  updateTenant as updateTenantQuery,
  updateTenantSettings,
  listProcedureTypes as listProcedureTypesQuery,
  getProcedureType as getProcedureTypeQuery,
  createProcedureType as createProcedureTypeQuery,
  updateProcedureType as updateProcedureTypeQuery,
  deleteProcedureType as deleteProcedureTypeQuery,
  listConsentTemplates as listConsentTemplatesQuery,
} from '@/db/queries/tenants'
import {
  updateTenantSchema,
  procedureTypeSchema,
  updateProcedureTypeSchema,
  bookingSettingsSchema,
} from '@/validations/tenant'
import type { UpdateTenantInput, ProcedureTypeInput, UpdateProcedureTypeInput, BookingSettingsInput } from '@/validations/tenant'

export type ActionState = {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
} | null

// ─── TENANT SETTINGS ────────────────────────────────────────────────

export async function getTenantAction() {
  try {
    const auth = await requireRole('owner')
    return await getTenant(auth.tenantId)
  } catch {
    return null
  }
}

export async function updateTenantAction(data: UpdateTenantInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = updateTenantSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const existing = await getTenant(auth.tenantId)
    const tenant = await updateTenantQuery(auth.tenantId, parsed.data)
    if (!tenant) {
      return { error: 'Erro ao atualizar configurações' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: auth.tenantId,
      changes: { tenant: { old: existing, new: parsed.data } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar configurações' }
    }
    return { error: 'Erro ao atualizar configurações' }
  }
}

export async function updateBookingSettingsAction(data: BookingSettingsInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = bookingSettingsSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos' }
    }

    const tenant = await updateTenantSettings(auth.tenantId, {
      publicBookingEnabled: parsed.data.publicBookingEnabled,
    })

    if (!tenant) {
      return { error: 'Erro ao atualizar configurações de agendamento' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: auth.tenantId,
      changes: { bookingSettings: { old: null, new: parsed.data } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar configurações' }
    }
    return { error: 'Erro ao atualizar configurações de agendamento' }
  }
}

// ─── PROCEDURE TYPES ────────────────────────────────────────────────

export async function listProcedureTypesAction() {
  try {
    const auth = await requireRole('owner')
    return await listProcedureTypesQuery(auth.tenantId)
  } catch {
    return []
  }
}

export async function createProcedureTypeAction(data: ProcedureTypeInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = procedureTypeSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const pt = await createProcedureTypeQuery(auth.tenantId, parsed.data)

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'create',
      entityType: 'procedure_type',
      entityId: pt.id,
      changes: { procedureType: { old: null, new: parsed.data } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para criar procedimentos' }
    }
    return { error: 'Erro ao criar tipo de procedimento' }
  }
}

export async function updateProcedureTypeAction(data: UpdateProcedureTypeInput): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const parsed = updateProcedureTypeSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const { id, ...updateData } = parsed.data
    const existing = await getProcedureTypeQuery(auth.tenantId, id)
    if (!existing) {
      return { error: 'Tipo de procedimento não encontrado' }
    }

    const pt = await updateProcedureTypeQuery(auth.tenantId, id, updateData)
    if (!pt) {
      return { error: 'Erro ao atualizar tipo de procedimento' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'procedure_type',
      entityId: id,
      changes: { procedureType: { old: existing, new: updateData } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para editar procedimentos' }
    }
    return { error: 'Erro ao atualizar tipo de procedimento' }
  }
}

export async function deleteProcedureTypeAction(id: string): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    const pt = await deleteProcedureTypeQuery(auth.tenantId, id)
    if (!pt) {
      return { error: 'Tipo de procedimento não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'delete',
      entityType: 'procedure_type',
      entityId: id,
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para excluir procedimentos' }
    }
    return { error: 'Erro ao excluir tipo de procedimento' }
  }
}

// ─── CONSENT TEMPLATES ──────────────────────────────────────────────

export async function listConsentTemplatesAction() {
  try {
    const auth = await requireRole('owner')
    return await listConsentTemplatesQuery(auth.tenantId)
  } catch {
    return []
  }
}

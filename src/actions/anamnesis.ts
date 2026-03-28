'use server'

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { anamnesisSchema, type AnamnesisFormData } from '@/validations/anamnesis'

export type AnamnesisActionResult = {
  success: boolean
  error?: string
  data?: {
    id: string
    updatedAt: Date
    updatedBy: string | null
  }
}

export async function getAnamnesisAction(patientId: string) {
  const ctx = await requireRole('owner', 'practitioner')
  const anamnesis = await getAnamnesis(ctx.tenantId, patientId)
  return anamnesis
}

export async function upsertAnamnesisAction(
  patientId: string,
  formData: AnamnesisFormData,
  expectedUpdatedAt?: string
): Promise<AnamnesisActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = anamnesisSchema.safeParse(formData)
  if (!parsed.success) {
    return {
      success: false,
      error: 'Dados inválidos: ' + parsed.error.issues.map(i => i.message).join(', '),
    }
  }

  try {
    const existing = await getAnamnesis(ctx.tenantId, patientId)
    const isCreate = !existing

    const result = await upsertAnamnesis(
      ctx.tenantId,
      patientId,
      ctx.userId,
      parsed.data,
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined
    )

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: isCreate ? 'create' : 'update',
      entityType: 'anamnesis',
      entityId: result.id,
      changes: isCreate ? { created: { old: null, new: 'anamnesis' } } : undefined,
    })

    return {
      success: true,
      data: {
        id: result.id,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
      },
    }
  } catch (err) {
    if (err instanceof StaleDataError) {
      return {
        success: false,
        error: err.message,
      }
    }
    throw err
  }
}

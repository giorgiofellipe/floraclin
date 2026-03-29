'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  saveEvaluationResponse,
  getEvaluationResponse,
  getEvaluationResponsesForProcedure,
} from '@/db/queries/evaluation-responses'
import type { EvaluationResponses } from '@/types/evaluation'

export type EvaluationResponseActionState = {
  error?: string
  success?: boolean
  data?: unknown
} | null

// ─── Write Actions (owner + practitioner) ──────────────────────────

export async function saveEvaluationResponseAction(data: {
  procedureRecordId: string
  templateId: string
  responses: EvaluationResponses
}): Promise<EvaluationResponseActionState> {
  const ctx = await requireRole('owner', 'practitioner')

  try {
    const response = await saveEvaluationResponse(ctx.tenantId, data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'evaluation_response',
      entityId: response.id,
      changes: {
        templateId: { old: null, new: data.templateId },
        procedureRecordId: { old: null, new: data.procedureRecordId },
      },
    })

    return { success: true, data: response }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao salvar respostas da avaliacao' }
  }
}

// ─── Read Actions ──────────────────────────────────────────────────

export async function getEvaluationResponseAction(
  procedureRecordId: string,
  templateId: string
) {
  const ctx = await getAuthContext()
  return getEvaluationResponse(ctx.tenantId, procedureRecordId, templateId)
}

export async function getEvaluationResponsesForProcedureAction(
  procedureRecordId: string
) {
  const ctx = await getAuthContext()
  return getEvaluationResponsesForProcedure(ctx.tenantId, procedureRecordId)
}

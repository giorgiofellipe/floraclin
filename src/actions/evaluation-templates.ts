'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import {
  createTemplate,
  updateTemplate,
  resetTemplateToDefault,
  getTemplatesForProcedureTypes,
} from '@/db/queries/evaluation-templates'
import type { EvaluationSection, ProcedureCategory } from '@/types/evaluation'

export type ActionState = {
  success?: boolean
  error?: string
  sections?: EvaluationSection[]
} | null

export async function updateTemplateAction(data: {
  templateId: string
  sections: EvaluationSection[]
}): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')
    await updateTemplate(auth.tenantId, data.templateId, data.sections)
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar templates' }
    }
    return { error: 'Erro ao salvar template' }
  }
}

export async function createTemplateAction(data: {
  procedureTypeId: string
  name: string
  sections: EvaluationSection[]
}): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')
    await createTemplate(auth.tenantId, data.procedureTypeId, data.name, data.sections)
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para criar templates' }
    }
    return { error: 'Erro ao criar template' }
  }
}

export async function resetTemplateToDefaultAction(data: {
  templateId?: string
  procedureTypeId?: string
  procedureCategory: ProcedureCategory
  createIfMissing?: boolean
  procedureTypeName?: string
}): Promise<ActionState> {
  try {
    const auth = await requireRole('owner')

    if (data.templateId) {
      const updated = await resetTemplateToDefault(
        auth.tenantId,
        data.templateId,
        data.procedureCategory
      )
      return {
        success: true,
        sections: updated.sections as EvaluationSection[],
      }
    } else if (data.createIfMissing && data.procedureTypeId) {
      // Import defaults to create a new template
      const { defaultTemplates } = await import('@/lib/default-evaluation-templates')
      const defaultTemplate = defaultTemplates.find(
        (t) => t.category === data.procedureCategory
      )
      if (!defaultTemplate) {
        return { error: 'Nenhum template padrão disponível para esta categoria' }
      }
      const created = await createTemplate(
        auth.tenantId,
        data.procedureTypeId,
        data.procedureTypeName || 'Ficha de Avaliação',
        defaultTemplate.sections
      )
      return {
        success: true,
        sections: created.sections as EvaluationSection[],
      }
    }

    return { error: 'Parâmetros inválidos' }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para restaurar template' }
    }
    return { error: 'Erro ao restaurar template padrão' }
  }
}

// ─── Read Actions ──────────────────────────────────────────────────

export async function getTemplatesForProcedureTypesAction(
  procedureTypeIds: string[]
) {
  const ctx = await getAuthContext()
  return getTemplatesForProcedureTypes(ctx.tenantId, procedureTypeIds)
}

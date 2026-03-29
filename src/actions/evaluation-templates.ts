'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import {
  createTemplate,
  updateTemplate,
  resetTemplateToDefault,
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
    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissao para alterar templates' }
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
    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissao para criar templates' }
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
      revalidatePath('/configuracoes')
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
        return { error: 'Nenhum template padrao disponivel para esta categoria' }
      }
      const created = await createTemplate(
        auth.tenantId,
        data.procedureTypeId,
        data.procedureTypeName || 'Ficha de Avaliacao',
        defaultTemplate.sections
      )
      revalidatePath('/configuracoes')
      return {
        success: true,
        sections: created.sections as EvaluationSection[],
      }
    }

    return { error: 'Parametros invalidos' }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissao para restaurar template' }
    }
    return { error: 'Erro ao restaurar template padrao' }
  }
}

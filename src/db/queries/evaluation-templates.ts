import { db } from '@/db/client'
import { evaluationTemplates, procedureTypes } from '@/db/schema'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import type { EvaluationSection } from '@/types/evaluation'
import { defaultTemplates } from '@/lib/default-evaluation-templates'
import type { ProcedureCategory } from '@/types/evaluation'

export async function getTemplateForProcedureType(tenantId: string, procedureTypeId: string) {
  const [template] = await db
    .select()
    .from(evaluationTemplates)
    .where(
      and(
        eq(evaluationTemplates.tenantId, tenantId),
        eq(evaluationTemplates.procedureTypeId, procedureTypeId),
        isNull(evaluationTemplates.deletedAt)
      )
    )
    .limit(1)

  return template ?? null
}

export async function getTemplatesForProcedureTypes(tenantId: string, procedureTypeIds: string[]) {
  if (procedureTypeIds.length === 0) return []

  const templates = await db
    .select()
    .from(evaluationTemplates)
    .where(
      and(
        eq(evaluationTemplates.tenantId, tenantId),
        inArray(evaluationTemplates.procedureTypeId, procedureTypeIds),
        isNull(evaluationTemplates.deletedAt)
      )
    )

  return templates
}

export async function createTemplate(
  tenantId: string,
  procedureTypeId: string,
  name: string,
  sections: EvaluationSection[]
) {
  const [template] = await db
    .insert(evaluationTemplates)
    .values({
      tenantId,
      procedureTypeId,
      name,
      sections,
      isActive: true,
      version: 1,
    })
    .returning()

  return template
}

export async function updateTemplate(
  tenantId: string,
  templateId: string,
  sections: EvaluationSection[]
) {
  const existing = await getTemplateById(tenantId, templateId)
  if (!existing) {
    throw new Error('Template de avaliacao nao encontrado')
  }

  const [updated] = await db
    .update(evaluationTemplates)
    .set({
      sections,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evaluationTemplates.id, templateId),
        eq(evaluationTemplates.tenantId, tenantId),
        isNull(evaluationTemplates.deletedAt)
      )
    )
    .returning()

  return updated
}

export async function deleteTemplate(tenantId: string, templateId: string) {
  const [deleted] = await db
    .update(evaluationTemplates)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evaluationTemplates.id, templateId),
        eq(evaluationTemplates.tenantId, tenantId),
        isNull(evaluationTemplates.deletedAt)
      )
    )
    .returning()

  if (!deleted) {
    throw new Error('Template de avaliacao nao encontrado')
  }

  return deleted
}

export async function resetTemplateToDefault(
  tenantId: string,
  templateId: string,
  procedureCategory: ProcedureCategory
) {
  const defaultTemplate = defaultTemplates.find((t) => t.category === procedureCategory)
  if (!defaultTemplate) {
    throw new Error('Nenhum template padrao encontrado para esta categoria')
  }

  return updateTemplate(tenantId, templateId, defaultTemplate.sections)
}

export async function getTemplateById(tenantId: string, templateId: string) {
  const [template] = await db
    .select()
    .from(evaluationTemplates)
    .where(
      and(
        eq(evaluationTemplates.id, templateId),
        eq(evaluationTemplates.tenantId, tenantId),
        isNull(evaluationTemplates.deletedAt)
      )
    )
    .limit(1)

  return template ?? null
}

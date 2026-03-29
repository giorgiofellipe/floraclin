import { db } from '@/db/client'
import { evaluationResponses, evaluationTemplates } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getTemplateById } from './evaluation-templates'
import type { EvaluationResponses, EvaluationSection } from '@/types/evaluation'

interface SaveEvaluationResponseData {
  procedureRecordId: string
  templateId: string
  responses: EvaluationResponses
}

export async function saveEvaluationResponse(
  tenantId: string,
  data: SaveEvaluationResponseData
) {
  // Load the current template to get version and snapshot
  const template = await getTemplateById(tenantId, data.templateId)
  if (!template) {
    throw new Error('Template de avaliacao nao encontrado')
  }

  // Check if a response already exists for this procedure + template
  const existing = await getEvaluationResponse(
    tenantId,
    data.procedureRecordId,
    data.templateId
  )

  if (existing) {
    // Update existing response
    const [updated] = await db
      .update(evaluationResponses)
      .set({
        responses: data.responses,
        templateVersion: template.version,
        templateSnapshot: template.sections,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(evaluationResponses.id, existing.id),
          eq(evaluationResponses.tenantId, tenantId)
        )
      )
      .returning()

    return updated
  }

  // Create new response
  const [response] = await db
    .insert(evaluationResponses)
    .values({
      tenantId,
      procedureRecordId: data.procedureRecordId,
      templateId: data.templateId,
      templateVersion: template.version,
      templateSnapshot: template.sections,
      responses: data.responses,
    })
    .returning()

  return response
}

export async function getEvaluationResponse(
  tenantId: string,
  procedureRecordId: string,
  templateId: string
) {
  const [response] = await db
    .select()
    .from(evaluationResponses)
    .where(
      and(
        eq(evaluationResponses.tenantId, tenantId),
        eq(evaluationResponses.procedureRecordId, procedureRecordId),
        eq(evaluationResponses.templateId, templateId)
      )
    )
    .limit(1)

  return response ?? null
}

export async function getEvaluationResponsesForProcedure(
  tenantId: string,
  procedureRecordId: string
) {
  const responses = await db
    .select({
      id: evaluationResponses.id,
      procedureRecordId: evaluationResponses.procedureRecordId,
      templateId: evaluationResponses.templateId,
      templateVersion: evaluationResponses.templateVersion,
      templateSnapshot: evaluationResponses.templateSnapshot,
      responses: evaluationResponses.responses,
      createdAt: evaluationResponses.createdAt,
      updatedAt: evaluationResponses.updatedAt,
      templateName: evaluationTemplates.name,
    })
    .from(evaluationResponses)
    .innerJoin(
      evaluationTemplates,
      eq(evaluationResponses.templateId, evaluationTemplates.id)
    )
    .where(
      and(
        eq(evaluationResponses.tenantId, tenantId),
        eq(evaluationResponses.procedureRecordId, procedureRecordId)
      )
    )

  return responses
}

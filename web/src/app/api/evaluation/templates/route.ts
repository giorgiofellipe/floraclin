import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTemplatesForProcedureTypes, createTemplate, updateTemplate, resetTemplateToDefault } from '@/db/queries/evaluation-templates'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const typeIds = searchParams.getAll('typeId').filter(Boolean)

    if (typeIds.length === 0) {
      return NextResponse.json([])
    }

    const templates = await getTemplatesForProcedureTypes(ctx.tenantId, typeIds)
    return NextResponse.json(templates)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const body = await request.json()
    const { action } = body

    if (action === 'create') {
      const template = await createTemplate(ctx.tenantId, body.procedureTypeId, body.name, body.sections)
      return NextResponse.json({ success: true, data: template })
    }

    if (action === 'update') {
      await updateTemplate(ctx.tenantId, body.templateId, body.sections)
      return NextResponse.json({ success: true })
    }

    if (action === 'reset') {
      if (body.templateId) {
        const updated = await resetTemplateToDefault(ctx.tenantId, body.templateId, body.procedureCategory)
        return NextResponse.json({ success: true, sections: updated.sections })
      } else if (body.createIfMissing && body.procedureTypeId) {
        const { defaultTemplates } = await import('@/lib/default-evaluation-templates')
        const defaultTemplate = defaultTemplates.find((t) => t.category === body.procedureCategory)
        if (!defaultTemplate) {
          return NextResponse.json({ error: 'Nenhum template padrão disponível para esta categoria' }, { status: 404 })
        }
        const created = await createTemplate(
          ctx.tenantId,
          body.procedureTypeId,
          body.procedureTypeName || 'Ficha de Avaliação',
          defaultTemplate.sections
        )
        return NextResponse.json({ success: true, sections: created.sections })
      }
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (error) {
    return handleApiError(error, request)
  }
}

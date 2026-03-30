import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTemplatesForProcedureTypes, createTemplate, updateTemplate, resetTemplateToDefault } from '@/db/queries/evaluation-templates'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const typeIdsParam = searchParams.get('typeIds')
    const typeIds = typeIdsParam ? typeIdsParam.split(',').filter(Boolean) : []

    if (typeIds.length === 0) {
      return NextResponse.json([])
    }

    const templates = await getTemplatesForProcedureTypes(ctx.tenantId, typeIds)
    return NextResponse.json(templates)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

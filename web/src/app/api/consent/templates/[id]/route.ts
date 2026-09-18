import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { getConsentTemplateById, updateConsentTemplate } from '@/db/queries/consent'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id: templateId } = await params
    const template = await getConsentTemplateById(ctx.tenantId, templateId)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }
    return NextResponse.json(template)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id: templateId } = await params
    const body = await request.json()

    if (!body.content) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    const template = await updateConsentTemplate(ctx.tenantId, templateId, {
      title: body.title || undefined,
      content: body.content,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'consent_template',
      entityId: template.id,
      changes: { version: { old: template.version - 1, new: template.version } },
    })

    return NextResponse.json({ success: true, data: template })
  } catch (error) {
    return handleApiError(error, request)
  }
}

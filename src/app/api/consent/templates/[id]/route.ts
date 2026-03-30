import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getConsentTemplateById, updateConsentTemplate } from '@/db/queries/consent'

export async function GET(
  _request: Request,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

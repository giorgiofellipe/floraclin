import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getTemplateById,
  updateLocalTemplate,
  deleteLocalTemplate,
  getAutomationUsingTemplate,
} from '@/db/queries/whatsapp'
import {
  canManageTemplates,
  getTemplate as getMetaTemplate,
  editTemplate as editMetaTemplate,
  deleteTemplate as deleteMetaTemplate,
  isWhatsAppEnabled,
} from '@/lib/whatsapp'
import { updateTemplateSchema } from '@/validations/whatsapp'

type RouteParams = { params: Promise<{ id: string }> }

// A system template is platform content every shared-number clinic sends.
// The row still belongs to the tenant that seeded it, so tenant scoping alone
// would let that one clinic edit or delete it for everybody.
const SYSTEM_TEMPLATE_ERROR = 'Template gerenciado pelo FloraClin'

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }

    if (template.metaTemplateId) {
      try {
        const metaData = await getMetaTemplate(ctx.tenantId, template.metaTemplateId)
        await updateLocalTemplate(ctx.tenantId, id, {
          status: metaData.status,
          rejectedReason: metaData.rejected_reason ?? null,
          syncedAt: new Date(),
        })
        const refreshed = await getTemplateById(ctx.tenantId, id)
        return NextResponse.json({ data: refreshed })
      } catch {
        return NextResponse.json({ data: template })
      }
    }

    return NextResponse.json({ data: template })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error fetching WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner' || !canManageTemplates(settings)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }
    if (template.systemTemplate) {
      return NextResponse.json({ error: SYSTEM_TEMPLATE_ERROR }, { status: 403 })
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Apenas templates aprovados podem ser editados' },
        { status: 400 },
      )
    }
    if (!template.metaTemplateId) {
      return NextResponse.json({ error: 'Template sem ID na Meta' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = updateTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await editMetaTemplate(ctx.tenantId, template.metaTemplateId, parsed.data.components)

    const updated = await updateLocalTemplate(ctx.tenantId, id, {
      components: parsed.data.components,
      status: 'PENDING',
      variableMapping: parsed.data.variableMapping ?? template.variableMapping,
      submittedAt: new Date(),
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    console.error('Error updating WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner' || !canManageTemplates(settings)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const template = await getTemplateById(ctx.tenantId, id)
    if (!template) {
      return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
    }
    if (template.systemTemplate) {
      return NextResponse.json({ error: SYSTEM_TEMPLATE_ERROR }, { status: 403 })
    }

    const activeAutomation = await getAutomationUsingTemplate(ctx.tenantId, id)
    if (activeAutomation) {
      return NextResponse.json(
        { error: 'Desative a automação vinculada antes de excluir o template' },
        { status: 400 },
      )
    }

    if (template.metaTemplateId) {
      try {
        await deleteMetaTemplate(ctx.tenantId, template.name)
      } catch (err) {
        console.error('Failed to delete template from Meta:', err)
      }
    }

    await deleteLocalTemplate(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error deleting WhatsApp template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

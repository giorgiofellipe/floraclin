import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { upsertAutomation, getTemplateById } from '@/db/queries/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp'
import { updateAutomationSchema } from '@/validations/whatsapp'
import { handleApiError } from '@/lib/api-error'

const VALID_TRIGGERS = ['appointment_confirmation', 'payment_reminder', 'follow_up']

type RouteParams = { params: Promise<{ trigger: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { trigger } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    const { blocked } = await requireWrite('owner')
    if (blocked) return blocked

    if (!VALID_TRIGGERS.includes(trigger)) {
      return NextResponse.json({ error: 'Trigger inválido' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = updateAutomationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    if (parsed.data.templateId) {
      const template = await getTemplateById(ctx.tenantId, parsed.data.templateId)
      if (!template) {
        return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })
      }
    }

    const automation = await upsertAutomation(ctx.tenantId, trigger, parsed.data)
    return NextResponse.json({ data: automation })
  } catch (error) {
    return handleApiError(error, request)
  }
}

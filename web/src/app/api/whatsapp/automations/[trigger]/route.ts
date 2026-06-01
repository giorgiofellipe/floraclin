import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { upsertAutomation, getTemplateById } from '@/db/queries/whatsapp'
import { updateAutomationSchema } from '@/validations/whatsapp'

const VALID_TRIGGERS = ['appointment_confirmation', 'payment_reminder', 'follow_up']

type RouteParams = { params: Promise<{ trigger: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { trigger } = await params
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error updating WhatsApp automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

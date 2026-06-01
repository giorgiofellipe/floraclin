import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { listConversations, upsertConversation, createMessage, pushSseEvent, getTemplateByName } from '@/db/queries/whatsapp'
import { conversationFilterSchema } from '@/validations/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'

async function checkWhatsAppAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 }) }
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (!settings.whatsapp_enabled) {
    return { error: NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 }) }
  }

  const allowedRoles = (settings.whatsapp_allowed_roles as string[]) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ctx, tenant }
}

export async function GET(request: Request) {
  try {
    const result = await checkWhatsAppAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { searchParams } = new URL(request.url)
    const parsed = conversationFilterSchema.safeParse({
      search: searchParams.get('search') ?? undefined,
      filter: searchParams.get('filter') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data = await listConversations(ctx.tenantId, parsed.data)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

const startConversationSchema = z.object({
  patientId: z.string().uuid(),
  templateName: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  params: z.record(z.string(), z.string()).optional(),
})

export async function POST(request: Request) {
  try {
    const result = await checkWhatsAppAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const body = await request.json()
    const parsed = startConversationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const phone = patient.phone.replace(/\D/g, '')
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

    const conversation = await upsertConversation(
      ctx.tenantId,
      normalizedPhone,
      patient.fullName,
      undefined,
      patient.id,
    )

    if (parsed.data.templateName && parsed.data.language) {
      const sendResult = await sendTemplateMessage(
        ctx.tenantId,
        normalizedPhone,
        parsed.data.templateName,
        parsed.data.language,
        parsed.data.params,
      )

      const tpl = await getTemplateByName(ctx.tenantId, parsed.data.templateName, parsed.data.language)
      const templateBody = tpl ? resolveTemplateBody(tpl.components, parsed.data.params) : null

      const message = await createMessage(ctx.tenantId, conversation.id, {
        direction: 'outbound',
        metaMessageId: sendResult.metaMessageId,
        body: templateBody,
        templateName: parsed.data.templateName,
        deliveryStatus: 'sent',
      })

      await pushSseEvent(ctx.tenantId, 'new_message', {
        conversationId: conversation.id,
        message,
      })

      return NextResponse.json({ success: true, data: { conversation, message } }, { status: 201 })
    }

    return NextResponse.json({ success: true, data: { conversation } }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      const detail = msg.replace('Meta API error: ', '')
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${detail}` }, { status: 502 })
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

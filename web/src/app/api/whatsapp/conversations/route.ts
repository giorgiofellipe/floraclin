import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { listConversations, upsertConversation, createMessage, pushSseEvent, getTemplateByName } from '@/db/queries/whatsapp'
import { conversationFilterSchema } from '@/validations/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, isWhatsAppEnabled } from '@/lib/whatsapp'
import { isSubscriptionActive, SUBSCRIPTION_EXPIRED_RESPONSE } from '@/lib/plans'
import { toWhatsAppPhone } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'

async function checkWhatsAppAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 }) }
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (!isWhatsAppEnabled(settings)) {
    return { error: NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 }) }
  }

  if (!(await isSubscriptionActive(ctx.tenantId))) {
    return { error: NextResponse.json(SUBSCRIPTION_EXPIRED_RESPONSE.body, { status: SUBSCRIPTION_EXPIRED_RESPONSE.status }) }
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
    return handleApiError(error, request)
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

    const normalizedPhone = toWhatsAppPhone(patient.phone)

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
    return handleApiError(error, request)
  }
}

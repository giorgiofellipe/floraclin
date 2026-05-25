import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getConversation,
  listMessages,
  createMessage,
  pushSseEvent,
} from '@/db/queries/whatsapp'
import {
  sendMessageSchema,
  sendTemplateSchema,
  sendMediaSchema,
} from '@/validations/whatsapp'
import { sendTextMessage, sendTemplateMessage, sendMediaMessage } from '@/lib/whatsapp'
import { getProspect, updateProspect } from '@/db/queries/prospects'

const messageListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

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

  return { ctx }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await checkWhatsAppAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id: conversationId } = await params

    const conversation = await getConversation(ctx.tenantId, conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = messageListSchema.safeParse({
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data = await listMessages(ctx.tenantId, conversationId, parsed.data)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await checkWhatsAppAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id: conversationId } = await params

    const conversation = await getConversation(ctx.tenantId, conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const body = await request.json()

    let metaMessageId: string
    let messageBody: string | null = null
    let mediaType: string | null = null
    let mediaUrl: string | null = null
    let templateName: string | null = null

    if ('templateName' in body) {
      const parsed = sendTemplateSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const result = await sendTemplateMessage(
        ctx.tenantId,
        conversation.phoneNumber,
        parsed.data.templateName,
        parsed.data.language,
        parsed.data.params,
      )
      metaMessageId = result.metaMessageId
      templateName = parsed.data.templateName
    } else if ('mediaType' in body) {
      const parsed = sendMediaSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const result = await sendMediaMessage(
        ctx.tenantId,
        conversation.phoneNumber,
        parsed.data.mediaType,
        parsed.data.mediaUrl,
        parsed.data.caption,
      )
      metaMessageId = result.metaMessageId
      mediaType = parsed.data.mediaType
      mediaUrl = parsed.data.mediaUrl
      messageBody = parsed.data.caption ?? null
    } else {
      const parsed = sendMessageSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const result = await sendTextMessage(
        ctx.tenantId,
        conversation.phoneNumber,
        parsed.data.body,
      )
      metaMessageId = result.metaMessageId
      messageBody = parsed.data.body
    }

    const message = await createMessage(ctx.tenantId, conversationId, {
      direction: 'outbound',
      metaMessageId,
      body: messageBody,
      mediaType,
      mediaUrl,
      templateName,
      deliveryStatus: 'sent',
    })

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId,
      message,
    })

    if (conversation.prospectId) {
      const prospect = await getProspect(ctx.tenantId, conversation.prospectId)
      if (prospect?.stage === 'novo') {
        await updateProspect(ctx.tenantId, prospect.id, { stage: 'contatado' })
        await pushSseEvent(ctx.tenantId, 'prospect_updated', {
          prospectId: prospect.id,
          stage: 'contatado',
        })
      }
    }

    return NextResponse.json({ success: true, data: message }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

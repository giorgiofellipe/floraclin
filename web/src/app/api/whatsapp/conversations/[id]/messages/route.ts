import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getConversation,
  listMessages,
  createMessage,
  pushSseEvent,
  getTemplateByPurpose,
  getTemplateByName,
  getQueuedCount,
  createQueuedMessage,
  expireStaleQueuedMessages,
} from '@/db/queries/whatsapp'
import {
  sendMessageSchema,
  sendTemplateSchema,
  sendMediaSchema,
} from '@/validations/whatsapp'
import { sendTextMessage, sendTemplateMessage, sendMediaMessage, resolveTemplateBody } from '@/lib/whatsapp'
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

function isWindowOpen(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return lastInboundAt > twentyFourHoursAgo
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

      const tpl = await getTemplateByName(ctx.tenantId, parsed.data.templateName, parsed.data.language)
      if (tpl) {
        messageBody = resolveTemplateBody(tpl.components, parsed.data.params)
      }
    } else if ('mediaType' in body) {
      const parsed = sendMediaSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      if (!isWindowOpen(conversation.lastInboundAt)) {
        return NextResponse.json(
          { error: 'Janela de 24h expirada — envie um template primeiro para reabrir a conversa.' },
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

      if (!isWindowOpen(conversation.lastInboundAt)) {
        const expiredIds = await expireStaleQueuedMessages(ctx.tenantId, conversationId)
        if (expiredIds.length > 0) {
          await pushSseEvent(ctx.tenantId, 'queue_expired', {
            conversationId,
            queuedMessageIds: expiredIds,
          })
        }

        const queueCount = await getQueuedCount(ctx.tenantId, conversationId)

        if (queueCount >= 20) {
          return NextResponse.json(
            { error: 'Limite de mensagens na fila atingido (máx. 20). Aguarde a resposta do paciente.' },
            { status: 429 },
          )
        }

        let resumeMetaMessageId: string | null = null
        if (queueCount === 0) {
          const resumeTemplate = await getTemplateByPurpose(ctx.tenantId, 'resume_conversation')
          if (!resumeTemplate || resumeTemplate.status !== 'APPROVED') {
            return NextResponse.json(
              { error: 'Template resume_conversation não disponível. Use um template manualmente.' },
              { status: 400 },
            )
          }

          const firstName = conversation.profileName?.split(' ')[0] ?? 'paciente'
          const resumeResult = await sendTemplateMessage(
            ctx.tenantId,
            conversation.phoneNumber,
            resumeTemplate.name,
            resumeTemplate.language,
            { '1': firstName },
          )
          resumeMetaMessageId = resumeResult.metaMessageId

          const resumeMessage = await createMessage(ctx.tenantId, conversationId, {
            direction: 'outbound',
            metaMessageId: resumeMetaMessageId,
            body: resolveTemplateBody(resumeTemplate.components, { '1': firstName }),
            templateName: resumeTemplate.name,
            deliveryStatus: 'sent',
          })

          await pushSseEvent(ctx.tenantId, 'new_message', {
            conversationId,
            message: resumeMessage,
          })
        }

        const queued = await createQueuedMessage(ctx.tenantId, conversationId, {
          body: parsed.data.body,
          resumeMetaMessageId,
        })

        const queuedMessage = {
          id: queued.id,
          conversationId,
          direction: 'outbound' as const,
          body: parsed.data.body,
          deliveryStatus: 'queued',
          createdAt: queued.createdAt,
          timestamp: queued.createdAt,
          metaMessageId: null,
          mediaType: null,
          mediaUrl: null,
          mediaFilename: null,
          templateName: null,
          errorCode: null,
        }

        await pushSseEvent(ctx.tenantId, 'new_message', {
          conversationId,
          message: queuedMessage,
        })

        return NextResponse.json({
          success: true,
          data: queuedMessage,
          queued: true,
          resumeSent: queueCount === 0,
        }, { status: 201 })
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
      const detail = msg.replace('Meta API error: ', '')
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${detail}` }, { status: 502 })
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

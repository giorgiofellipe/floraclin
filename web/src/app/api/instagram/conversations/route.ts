import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  listConversations,
  getConversationByIgsid,
  createMessage,
  pushSseEvent,
  getProspectByIgsid,
} from '@/db/queries/instagram'
import { conversationFilterSchema } from '@/validations/whatsapp'
import { startInstagramConversationSchema } from '@/validations/instagram'
import { sendTextMessage } from '@/lib/instagram'
import { db } from '@/db/client'
import { instagramConversations } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { updateProspect } from '@/db/queries/prospects'
import { computeWindowTag } from './[id]/messages/route'

async function checkInstagramAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 }) }
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (!settings.instagram_enabled) {
    return { error: NextResponse.json({ error: 'Instagram não habilitado' }, { status: 403 }) }
  }

  const allowedRoles = (settings.instagram_allowed_roles as string[]) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ctx, tenant }
}

export async function GET(request: Request) {
  try {
    const result = await checkInstagramAccess()
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

    const data = await listConversations(ctx.tenantId, {
      search: parsed.data.search,
      filter: parsed.data.filter,
      page: parsed.data.page,
      pageSize: parsed.data.limit,
    })
    return NextResponse.json(data)
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
    const result = await checkInstagramAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const body = await request.json()
    const parsed = startInstagramConversationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Instagram does not allow messaging users who haven't messaged the clinic first.
    // We require an existing conversation row for the IGSID.
    const conversation = await getConversationByIgsid(ctx.tenantId, parsed.data.igsid)
    if (!conversation) {
      return NextResponse.json(
        {
          error: 'unknown_igsid',
          message:
            'Instagram não permite iniciar conversas com usuários que ainda não enviaram mensagem para a clínica.',
        },
        { status: 422 },
      )
    }

    const tagResult = computeWindowTag(conversation.lastInboundAt, Date.now())
    if (tagResult.outsideWindow) {
      return NextResponse.json(
        { error: 'outside_messaging_window', lastInboundAt: conversation.lastInboundAt },
        { status: 422 },
      )
    }

    const sendResult = await sendTextMessage(
      ctx.tenantId,
      conversation.igsid,
      parsed.data.body,
      { tag: tagResult.tag ?? undefined },
    )

    const message = await createMessage({
      tenantId: ctx.tenantId,
      conversationId: conversation.id,
      direction: 'outbound',
      metaMessageId: sendResult.metaMessageId,
      body: parsed.data.body,
      deliveryStatus: 'sent',
      messageTag: tagResult.tag,
    })

    await db
      .update(instagramConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(instagramConversations.id, conversation.id),
          eq(instagramConversations.tenantId, ctx.tenantId),
        ),
      )

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId: conversation.id,
      message,
    })

    // Mirror WhatsApp prospect transition: novo → contatado on outbound send.
    if (conversation.prospectId) {
      const prospect = await getProspectByIgsid(ctx.tenantId, conversation.igsid)
      if (prospect?.stage === 'novo') {
        await updateProspect(ctx.tenantId, prospect.id, { stage: 'contatado' })
        await pushSseEvent(ctx.tenantId, 'prospect_updated', {
          prospectId: prospect.id,
          stage: 'contatado',
        })
      }
    }

    return NextResponse.json(
      { success: true, data: { conversation, message } },
      { status: 201 },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      const detail = msg.replace('Meta API error: ', '')
      if (/\(190\)|access token|OAuth/i.test(detail)) {
        return NextResponse.json(
          { error: 'meta_token_invalid', detail },
          { status: 502 },
        )
      }
      if (/\((?:4|17|32|613)\)|rate limit|too many/i.test(detail)) {
        return NextResponse.json(
          { error: 'meta_rate_limited', detail },
          { status: 502 },
        )
      }
      return NextResponse.json({ error: `Falha ao enviar via Instagram: ${detail}` }, { status: 502 })
    }
    if (msg.includes('Instagram credentials missing')) {
      return NextResponse.json({ error: 'instagram_credentials_missing' }, { status: 502 })
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

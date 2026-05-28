import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getConversationById,
  listMessages,
  createMessage,
  pushSseEvent,
  getProspectByIgsid,
} from '@/db/queries/instagram'
import { sendInstagramMessageSchema } from '@/validations/instagram'
import { sendTextMessage, sendMediaMessage } from '@/lib/instagram'
import { db } from '@/db/client'
import { instagramConversations } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { updateProspect } from '@/db/queries/prospects'

const messageListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const HOUR_MS = 3_600_000
const STANDARD_WINDOW_HOURS = 24
const HUMAN_AGENT_WINDOW_HOURS = 24 * 7

export type WindowTagResult =
  | { outsideWindow: false; tag: 'HUMAN_AGENT' | null }
  | { outsideWindow: true; tag: null }

/**
 * Compute the Instagram messaging window tag.
 *
 * - Inside 24h (or no prior inbound): no tag.
 * - 24h–168h since last inbound: 'HUMAN_AGENT' tag required.
 * - Past 168h: outside window, sending must be rejected with 422.
 *
 * Exported so the parent conversations route and tests can share the math.
 */
export function computeWindowTag(
  lastInboundAt: Date | null,
  now: number,
): WindowTagResult {
  if (!lastInboundAt) {
    return { outsideWindow: false, tag: null }
  }
  const hoursSince = (now - lastInboundAt.getTime()) / HOUR_MS
  if (hoursSince <= STANDARD_WINDOW_HOURS) {
    return { outsideWindow: false, tag: null }
  }
  if (hoursSince <= HUMAN_AGENT_WINDOW_HOURS) {
    return { outsideWindow: false, tag: 'HUMAN_AGENT' }
  }
  return { outsideWindow: true, tag: null }
}

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

  return { ctx }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await checkInstagramAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id: conversationId } = await params

    const conversation = await getConversationById(ctx.tenantId, conversationId)
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

    const data = await listMessages(conversationId, {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await checkInstagramAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id: conversationId } = await params

    const conversation = await getConversationById(ctx.tenantId, conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = sendInstagramMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tagResult = computeWindowTag(conversation.lastInboundAt, Date.now())
    if (tagResult.outsideWindow) {
      return NextResponse.json(
        { error: 'outside_messaging_window', lastInboundAt: conversation.lastInboundAt },
        { status: 422 },
      )
    }

    const messageTag = tagResult.tag

    let metaMessageId: string
    let messageBody: string | null = null
    let mediaType: string | null = null
    let mediaUrl: string | null = null

    if (parsed.data.type === 'text') {
      const sendResult = await sendTextMessage(
        ctx.tenantId,
        conversation.igsid,
        parsed.data.body,
        { tag: messageTag ?? undefined },
      )
      metaMessageId = sendResult.metaMessageId
      messageBody = parsed.data.body
    } else {
      const sendResult = await sendMediaMessage(
        ctx.tenantId,
        conversation.igsid,
        parsed.data.mediaType,
        parsed.data.mediaUrl,
        { tag: messageTag ?? undefined },
      )
      metaMessageId = sendResult.metaMessageId
      mediaType = parsed.data.mediaType
      mediaUrl = parsed.data.mediaUrl
      messageBody = parsed.data.caption ?? null
    }

    const message = await createMessage({
      tenantId: ctx.tenantId,
      conversationId,
      direction: 'outbound',
      // Use the specific media type (image/video/audio/file) instead of the
      // umbrella 'media' so message rows match the inbound shape.
      messageType:
        parsed.data.type === 'text' ? 'text' : parsed.data.mediaType,
      metaMessageId,
      body: messageBody,
      mediaType,
      mediaUrl,
      deliveryStatus: 'sent',
      messageTag,
    })

    await db
      .update(instagramConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(instagramConversations.id, conversationId),
          eq(instagramConversations.tenantId, ctx.tenantId),
        ),
      )

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId,
      message,
    })

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

    return NextResponse.json({ success: true, data: message }, { status: 201 })
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

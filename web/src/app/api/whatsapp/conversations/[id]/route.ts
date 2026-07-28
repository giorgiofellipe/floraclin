import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getConversation, markConversationRead } from '@/db/queries/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp'
import { db } from '@/db/client'
import { whatsappConversations } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
    }

    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const conversation = await getConversation(ctx.tenantId, id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    return NextResponse.json(conversation)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

const conversationActionSchema = z.object({
  action: z.enum(['mark_read', 'archive']),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
    }

    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const allowedRoles = (settings.whatsapp_allowed_roles as string[]) ?? ['owner']
    if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = conversationActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const existing = await getConversation(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    if (parsed.data.action === 'mark_read') {
      const updated = await markConversationRead(ctx.tenantId, id)
      return NextResponse.json({ success: true, data: updated })
    }

    if (parsed.data.action === 'archive') {
      const [updated] = await db.update(whatsappConversations)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(
          eq(whatsappConversations.id, id),
          eq(whatsappConversations.tenantId, ctx.tenantId),
        ))
        .returning()
      return NextResponse.json({ success: true, data: updated })
    }

    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

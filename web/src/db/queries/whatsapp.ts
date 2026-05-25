import { db } from '@/db/client'
import {
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  sseEvents,
} from '@/db/schema'
import { eq, and, or, desc, gt, ilike, sql } from 'drizzle-orm'
import type { PaginatedResult } from '@/types'

// ─── TYPE EXPORTS ──────────────────────────────────────────────────

export type WhatsappConversation = typeof whatsappConversations.$inferSelect
export type WhatsappMessage = typeof whatsappMessages.$inferSelect
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect
export type SseEvent = typeof sseEvents.$inferSelect

// ─── CONVERSATIONS ─────────────────────────────────────────────────

export async function upsertConversation(
  tenantId: string,
  phoneNumber: string,
  profileName?: string | null,
  prospectId?: string | null,
  patientId?: string | null
): Promise<WhatsappConversation> {
  const [existing] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.phoneNumber, phoneNumber)
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(whatsappConversations)
      .set({
        profileName: profileName ?? existing.profileName,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        ...(prospectId !== undefined ? { prospectId } : {}),
        ...(patientId !== undefined ? { patientId } : {}),
      })
      .where(eq(whatsappConversations.id, existing.id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(whatsappConversations)
    .values({
      tenantId,
      phoneNumber,
      profileName,
      prospectId,
      patientId,
    })
    .returning()

  return created
}

export async function getConversation(
  tenantId: string,
  conversationId: string
): Promise<WhatsappConversation | null> {
  const [conv] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantId)
      )
    )
    .limit(1)

  return conv ?? null
}

export async function getConversationByPhone(
  tenantId: string,
  phoneNumber: string
): Promise<WhatsappConversation | null> {
  const [conv] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.phoneNumber, phoneNumber)
      )
    )
    .limit(1)

  return conv ?? null
}

export async function listConversations(
  tenantId: string,
  {
    search = '',
    filter = 'all',
    page = 1,
    limit = 20,
  }: { search?: string; filter?: string; page?: number; limit?: number }
): Promise<PaginatedResult<WhatsappConversation>> {
  const offset = (page - 1) * limit

  const conditions = [eq(whatsappConversations.tenantId, tenantId)]

  const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  if (escaped) {
    conditions.push(
      or(
        ilike(whatsappConversations.profileName, `%${escaped}%`),
        ilike(whatsappConversations.phoneNumber, `%${escaped}%`)
      )!
    )
  }

  if (filter === 'unread') {
    conditions.push(gt(whatsappConversations.unreadCount, 0))
  } else if (filter === 'prospects') {
    conditions.push(sql`${whatsappConversations.prospectId} IS NOT NULL`)
  } else if (filter === 'patients') {
    conditions.push(sql`${whatsappConversations.patientId} IS NOT NULL`)
  }

  const whereConditions = and(...conditions)

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(whatsappConversations)
      .where(whereConditions)
      .orderBy(desc(whatsappConversations.lastMessageAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(whatsappConversations)
      .where(whereConditions),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function markConversationRead(
  tenantId: string,
  conversationId: string
): Promise<WhatsappConversation | null> {
  const [updated] = await db
    .update(whatsappConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantId)
      )
    )
    .returning()

  return updated ?? null
}

export async function incrementUnreadCount(
  tenantId: string,
  conversationId: string
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({
      unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantId)
      )
    )
}

export async function updateConversationLinks(
  tenantId: string,
  conversationId: string,
  links: { prospectId?: string | null; patientId?: string | null }
): Promise<WhatsappConversation | null> {
  const [updated] = await db
    .update(whatsappConversations)
    .set({ ...links, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.id, conversationId),
        eq(whatsappConversations.tenantId, tenantId)
      )
    )
    .returning()

  return updated ?? null
}

// ─── MESSAGES ──────────────────────────────────────────────────────

export async function createMessage(
  tenantId: string,
  conversationId: string,
  data: {
    direction: string
    body?: string | null
    metaMessageId?: string | null
    mediaType?: string | null
    mediaUrl?: string | null
    mediaFilename?: string | null
    templateName?: string | null
    deliveryStatus?: string
    timestamp?: Date
  }
): Promise<WhatsappMessage> {
  const [msg] = await db
    .insert(whatsappMessages)
    .values({
      tenantId,
      conversationId,
      direction: data.direction,
      body: data.body,
      metaMessageId: data.metaMessageId,
      mediaType: data.mediaType,
      mediaUrl: data.mediaUrl,
      mediaFilename: data.mediaFilename,
      templateName: data.templateName,
      deliveryStatus: data.deliveryStatus ?? 'sent',
      timestamp: data.timestamp ?? new Date(),
    })
    .returning()

  return msg
}

export async function getMessageByMetaId(
  tenantId: string,
  metaMessageId: string
): Promise<WhatsappMessage | null> {
  const [msg] = await db
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        eq(whatsappMessages.metaMessageId, metaMessageId)
      )
    )
    .limit(1)

  return msg ?? null
}

export async function updateMessageStatus(
  tenantId: string,
  metaMessageId: string,
  status: string,
  errorCode?: string | null
): Promise<WhatsappMessage | null> {
  const [updated] = await db
    .update(whatsappMessages)
    .set({
      deliveryStatus: status,
      ...(errorCode !== undefined ? { errorCode } : {}),
    })
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        eq(whatsappMessages.metaMessageId, metaMessageId)
      )
    )
    .returning()

  return updated ?? null
}

export async function listMessages(
  tenantId: string,
  conversationId: string,
  { page = 1, limit = 50 }: { page?: number; limit?: number } = {}
): Promise<PaginatedResult<WhatsappMessage>> {
  const offset = (page - 1) * limit

  const whereConditions = and(
    eq(whatsappMessages.tenantId, tenantId),
    eq(whatsappMessages.conversationId, conversationId)
  )

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(whatsappMessages)
      .where(whereConditions)
      .orderBy(desc(whatsappMessages.timestamp))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(whatsappMessages)
      .where(whereConditions),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    data: data.reverse(),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

// ─── TEMPLATES ─────────────────────────────────────────────────────

export async function upsertTemplate(
  tenantId: string,
  template: {
    metaTemplateId: string
    name: string
    language: string
    category: string
    status: string
    components: unknown
  }
): Promise<WhatsappTemplate> {
  const [existing] = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.name, template.name),
        eq(whatsappTemplates.language, template.language)
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(whatsappTemplates)
      .set({
        metaTemplateId: template.metaTemplateId,
        category: template.category,
        status: template.status,
        components: template.components,
        syncedAt: new Date(),
      })
      .where(eq(whatsappTemplates.id, existing.id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(whatsappTemplates)
    .values({ tenantId, ...template })
    .returning()

  return created
}

export async function listTemplates(
  tenantId: string
): Promise<WhatsappTemplate[]> {
  return db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.tenantId, tenantId))
    .orderBy(whatsappTemplates.name)
}

// ─── SSE EVENTS ────────────────────────────────────────────────────

export async function pushSseEvent(
  tenantId: string,
  eventType: string,
  payload: unknown
): Promise<SseEvent> {
  const [event] = await db
    .insert(sseEvents)
    .values({ tenantId, eventType, payload })
    .returning()

  return event
}

export async function pollSseEvents(
  tenantId: string,
  sinceId: number
): Promise<SseEvent[]> {
  return db
    .select()
    .from(sseEvents)
    .where(
      and(
        eq(sseEvents.tenantId, tenantId),
        gt(sseEvents.id, sinceId)
      )
    )
    .orderBy(sseEvents.id)
    .limit(100)
}

export async function cleanupSseEvents(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  await db
    .delete(sseEvents)
    .where(sql`${sseEvents.createdAt} < ${fiveMinutesAgo}`)
}

// ─── STATS ─────────────────────────────────────────────────────────

export async function getUnreadCount(tenantId: string): Promise<number> {
  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${whatsappConversations.unreadCount}), 0)::int`,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.tenantId, tenantId))

  return result?.total ?? 0
}

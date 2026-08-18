import { db } from '@/db/client'
import {
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  whatsappAutomations,
  whatsappQueuedMessages,
  sseEvents,
} from '@/db/schema'
import { eq, and, or, desc, gt, gte, lt, ilike, sql, notInArray, inArray } from 'drizzle-orm'
import { normalizeBrPhone } from '@/lib/phone'
import type { PaginatedResult } from '@/types'

// ─── TYPE EXPORTS ──────────────────────────────────────────────────

export type WhatsappConversation = typeof whatsappConversations.$inferSelect
export type WhatsappMessage = typeof whatsappMessages.$inferSelect
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect
export type SseEvent = typeof sseEvents.$inferSelect
export type WhatsappAutomation = typeof whatsappAutomations.$inferSelect
export type WhatsappQueuedMessage = typeof whatsappQueuedMessages.$inferSelect

// ─── CONVERSATIONS ─────────────────────────────────────────────────

export async function upsertConversation(
  tenantId: string,
  phoneNumber: string,
  profileName?: string | null,
  prospectId?: string | null,
  patientId?: string | null
): Promise<WhatsappConversation> {
  const normalized = normalizeBrPhone(phoneNumber)
  const [existing] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.phoneNumber, normalized)
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
      phoneNumber: normalized,
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
        eq(whatsappConversations.phoneNumber, normalizeBrPhone(phoneNumber))
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

  const [conversations, countResult] = await Promise.all([
    db
      .select({
        id: whatsappConversations.id,
        tenantId: whatsappConversations.tenantId,
        phoneNumber: whatsappConversations.phoneNumber,
        profileName: whatsappConversations.profileName,
        prospectId: whatsappConversations.prospectId,
        patientId: whatsappConversations.patientId,
        lastMessageAt: whatsappConversations.lastMessageAt,
        lastInboundAt: whatsappConversations.lastInboundAt,
        unreadCount: whatsappConversations.unreadCount,
        status: whatsappConversations.status,
        createdAt: whatsappConversations.createdAt,
        updatedAt: whatsappConversations.updatedAt,
      })
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
  const convIds = conversations.map((c) => c.id)

  const lastMsgMap = new Map<string, { body: string; direction: string; deliveryStatus: string }>()
  if (convIds.length > 0) {
    const lastMsgs = await db
      .selectDistinctOn([whatsappMessages.conversationId], {
        conversationId: whatsappMessages.conversationId,
        body: whatsappMessages.body,
        templateName: whatsappMessages.templateName,
        mediaType: whatsappMessages.mediaType,
        mediaFilename: whatsappMessages.mediaFilename,
        direction: whatsappMessages.direction,
        deliveryStatus: whatsappMessages.deliveryStatus,
      })
      .from(whatsappMessages)
      .where(inArray(whatsappMessages.conversationId, convIds))
      .orderBy(whatsappMessages.conversationId, desc(whatsappMessages.timestamp))

    for (const m of lastMsgs) {
      const mediaLabels: Record<string, string> = { image: 'Imagem', video: 'Video', audio: 'Audio', sticker: 'Sticker' }
      const display = m.body
        || (m.templateName ? `[Template: ${m.templateName}]` : null)
        || (m.mediaType ? (mediaLabels[m.mediaType] ?? m.mediaFilename ?? m.mediaType) : null)
      if (display) lastMsgMap.set(m.conversationId, { body: display, direction: m.direction, deliveryStatus: m.deliveryStatus })
    }
  }

  const data = conversations.map((c) => {
    const lastMsg = lastMsgMap.get(c.id)
    return {
      ...c,
      lastMessageBody: lastMsg?.body ?? null,
      lastMessageDirection: lastMsg?.direction ?? null,
      lastMessageStatus: lastMsg?.deliveryStatus ?? null,
    }
  })

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

export async function getRecentInboundBodies(
  conversationId: string,
  limit = 5,
  after?: Date,
): Promise<string[]> {
  const conditions = [
    eq(whatsappMessages.conversationId, conversationId),
    eq(whatsappMessages.direction, 'inbound'),
    sql`${whatsappMessages.body} IS NOT NULL AND ${whatsappMessages.body} <> ''`,
  ]
  if (after) {
    conditions.push(gte(whatsappMessages.timestamp, after))
  }

  const rows = await db
    .select({ body: whatsappMessages.body })
    .from(whatsappMessages)
    .where(and(...conditions))
    .orderBy(desc(whatsappMessages.timestamp))
    .limit(limit)

  return rows.map((r) => r.body!).reverse()
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

const templateCache = new Map<string, { templates: WhatsappTemplate[]; at: number }>()
const TEMPLATE_CACHE_TTL = 10 * 60 * 1000 // 10 min safety net

function getCachedTemplates(tenantId: string): WhatsappTemplate[] | null {
  const entry = templateCache.get(tenantId)
  if (!entry) return null
  if (Date.now() - entry.at > TEMPLATE_CACHE_TTL) {
    templateCache.delete(tenantId)
    return null
  }
  return entry.templates
}

async function loadTemplates(tenantId: string): Promise<WhatsappTemplate[]> {
  const cached = getCachedTemplates(tenantId)
  if (cached) return cached
  const templates = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.tenantId, tenantId))
    .orderBy(whatsappTemplates.name)
  templateCache.set(tenantId, { templates, at: Date.now() })
  return templates
}

export function invalidateTemplateCache(tenantId: string): void {
  templateCache.delete(tenantId)
}

export async function upsertTemplate(
  tenantId: string,
  template: {
    metaTemplateId?: string | null
    name: string
    language: string
    category: string
    status: string
    components: unknown
    purposeKey?: string | null
    rejectedReason?: string | null
    blueprintSlug?: string | null
    submittedAt?: Date | null
    variableMapping?: unknown | null
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
        metaTemplateId: template.metaTemplateId ?? existing.metaTemplateId,
        category: template.category,
        status: template.status,
        components: template.components,
        rejectedReason: template.rejectedReason ?? null,
        syncedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappTemplates.id, existing.id),
          eq(whatsappTemplates.tenantId, tenantId),
        )
      )
      .returning()

    invalidateTemplateCache(tenantId)
    return updated
  }

  const [created] = await db
    .insert(whatsappTemplates)
    .values({
      tenantId,
      metaTemplateId: template.metaTemplateId ?? null,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      components: template.components,
      purposeKey: template.purposeKey ?? null,
      rejectedReason: template.rejectedReason ?? null,
      blueprintSlug: template.blueprintSlug ?? null,
      submittedAt: template.submittedAt ?? null,
      variableMapping: template.variableMapping ?? null,
    })
    .returning()

  invalidateTemplateCache(tenantId)
  return created
}

export async function listTemplates(
  tenantId: string,
): Promise<WhatsappTemplate[]> {
  return loadTemplates(tenantId)
}

export async function getTemplateById(
  tenantId: string,
  templateId: string,
): Promise<WhatsappTemplate | null> {
  const templates = await loadTemplates(tenantId)
  return templates.find((t) => t.id === templateId) ?? null
}

export async function getTemplateByName(
  tenantId: string,
  name: string,
  language: string,
): Promise<WhatsappTemplate | null> {
  const templates = await loadTemplates(tenantId)
  return templates.find((t) => t.name === name && t.language === language) ?? null
}

export async function getTemplateByPurpose(
  tenantId: string,
  purposeKey: string,
): Promise<WhatsappTemplate | null> {
  const templates = await loadTemplates(tenantId)
  return templates.find((t) => t.purposeKey === purposeKey) ?? null
}

export async function createLocalTemplate(
  tenantId: string,
  data: {
    metaTemplateId?: string | null
    name: string
    language: string
    category: string
    status: string
    components: unknown
    purposeKey?: string | null
    blueprintSlug?: string | null
    submittedAt?: Date | null
    variableMapping?: unknown | null
  },
): Promise<WhatsappTemplate> {
  const [created] = await db
    .insert(whatsappTemplates)
    .values({
      tenantId,
      metaTemplateId: data.metaTemplateId ?? null,
      name: data.name,
      language: data.language,
      category: data.category,
      status: data.status,
      components: data.components,
      purposeKey: data.purposeKey ?? null,
      blueprintSlug: data.blueprintSlug ?? null,
      submittedAt: data.submittedAt ?? null,
      variableMapping: data.variableMapping ?? null,
    })
    .returning()
  invalidateTemplateCache(tenantId)
  return created
}

export async function updateLocalTemplate(
  tenantId: string,
  templateId: string,
  data: Partial<{
    metaTemplateId: string | null
    status: string
    components: unknown
    rejectedReason: string | null
    purposeKey: string | null
    blueprintSlug: string | null
    submittedAt: Date | null
    variableMapping: unknown | null
    syncedAt: Date
  }>,
): Promise<WhatsappTemplate | null> {
  const [updated] = await db
    .update(whatsappTemplates)
    .set(data)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.id, templateId)
      )
    )
    .returning()
  invalidateTemplateCache(tenantId)
  return updated ?? null
}

export async function markStaleTemplates(
  tenantId: string,
  metaTemplateIds: string[],
): Promise<number> {
  if (metaTemplateIds.length === 0) return 0
  const updated = await db
    .update(whatsappTemplates)
    .set({ status: 'DELETED', syncedAt: new Date() })
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        notInArray(whatsappTemplates.metaTemplateId, metaTemplateIds),
        sql`${whatsappTemplates.metaTemplateId} IS NOT NULL`,
        sql`${whatsappTemplates.status} != 'DELETED'`
      )
    )
    .returning()
  if (updated.length > 0) invalidateTemplateCache(tenantId)
  return updated.length
}

export async function deleteLocalTemplate(
  tenantId: string,
  templateId: string,
): Promise<boolean> {
  const result = await db
    .delete(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.tenantId, tenantId),
        eq(whatsappTemplates.id, templateId)
      )
    )
    .returning()
  invalidateTemplateCache(tenantId)
  return result.length > 0
}

// ─── AUTOMATIONS ──────────────────────────────────────────────────

export async function listAutomations(
  tenantId: string,
): Promise<WhatsappAutomation[]> {
  return db
    .select()
    .from(whatsappAutomations)
    .where(eq(whatsappAutomations.tenantId, tenantId))
    .orderBy(whatsappAutomations.trigger)
}

export async function upsertAutomation(
  tenantId: string,
  trigger: string,
  data: {
    enabled?: boolean
    templateId?: string | null
    config?: unknown | null
  },
): Promise<WhatsappAutomation> {
  const [existing] = await db
    .select()
    .from(whatsappAutomations)
    .where(
      and(
        eq(whatsappAutomations.tenantId, tenantId),
        eq(whatsappAutomations.trigger, trigger)
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(whatsappAutomations)
      .set({
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.templateId !== undefined ? { templateId: data.templateId } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
        updatedAt: new Date(),
      })
      .where(eq(whatsappAutomations.id, existing.id))
      .returning()
    return updated
  }

  const [created] = await db
    .insert(whatsappAutomations)
    .values({
      tenantId,
      trigger,
      enabled: data.enabled ?? false,
      templateId: data.templateId ?? null,
      config: data.config ?? null,
    })
    .returning()
  return created
}

export async function getAutomationUsingTemplate(
  tenantId: string,
  templateId: string,
): Promise<WhatsappAutomation | null> {
  const [automation] = await db
    .select()
    .from(whatsappAutomations)
    .where(
      and(
        eq(whatsappAutomations.tenantId, tenantId),
        eq(whatsappAutomations.templateId, templateId),
        eq(whatsappAutomations.enabled, true)
      )
    )
    .limit(1)
  return automation ?? null
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

export async function getLatestSseEventId(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ maxId: sql<number>`COALESCE(MAX(${sseEvents.id}), 0)::int` })
    .from(sseEvents)
    .where(eq(sseEvents.tenantId, tenantId))
  return row?.maxId ?? 0
}

export async function cleanupSseEvents(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  await db
    .delete(sseEvents)
    .where(sql`${sseEvents.createdAt} < ${fiveMinutesAgo.toISOString()}`)
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

// ─── QUEUED MESSAGES ──────────────────────────────────────────────

export async function createQueuedMessage(
  tenantId: string,
  conversationId: string,
  data: {
    body?: string | null
    mediaType?: string | null
    mediaUrl?: string | null
    resumeMetaMessageId?: string | null
  },
): Promise<WhatsappQueuedMessage> {
  const [msg] = await db
    .insert(whatsappQueuedMessages)
    .values({
      tenantId,
      conversationId,
      body: data.body ?? null,
      mediaType: data.mediaType ?? null,
      mediaUrl: data.mediaUrl ?? null,
      resumeMetaMessageId: data.resumeMetaMessageId ?? null,
    })
    .returning()
  return msg
}

export async function getQueuedMessages(
  tenantId: string,
  conversationId: string,
): Promise<WhatsappQueuedMessage[]> {
  return db
    .select()
    .from(whatsappQueuedMessages)
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
      ),
    )
    .orderBy(whatsappQueuedMessages.createdAt)
}

export async function getQueuedCount(
  tenantId: string,
  conversationId: string,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappQueuedMessages)
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
      ),
    )
  return result?.count ?? 0
}

export async function updateQueuedMessageStatus(
  tenantId: string,
  id: string,
  status: 'sent' | 'expired',
): Promise<WhatsappQueuedMessage | null> {
  const extra = status === 'sent'
    ? { sentAt: new Date() }
    : { expiredAt: new Date() }

  const [updated] = await db
    .update(whatsappQueuedMessages)
    .set({ status, ...extra })
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.id, id),
      ),
    )
    .returning()
  return updated ?? null
}

export async function expireStaleQueuedMessages(
  tenantId: string,
  conversationId: string,
): Promise<string[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const expired = await db
    .update(whatsappQueuedMessages)
    .set({ status: 'expired', expiredAt: new Date() })
    .where(
      and(
        eq(whatsappQueuedMessages.tenantId, tenantId),
        eq(whatsappQueuedMessages.conversationId, conversationId),
        eq(whatsappQueuedMessages.status, 'queued'),
        lt(whatsappQueuedMessages.createdAt, twentyFourHoursAgo),
      ),
    )
    .returning()

  return expired.map((m) => m.id)
}

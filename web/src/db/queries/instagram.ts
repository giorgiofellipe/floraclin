import { db } from '@/db/client'
import {
  instagramConversations,
  instagramMessages,
  instagramSavedReplies,
  prospects,
} from '@/db/schema'
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { PaginatedResult } from '@/types'
import { pushSseEvent as pushSseEventChannel } from './whatsapp'

// ─── TYPE EXPORTS ──────────────────────────────────────────────────

export type InstagramConversation = typeof instagramConversations.$inferSelect
export type InstagramMessage = typeof instagramMessages.$inferSelect
export type InstagramSavedReply = typeof instagramSavedReplies.$inferSelect

// ─── CONVERSATIONS ─────────────────────────────────────────────────

export async function upsertConversation(opts: {
  tenantId: string
  igsid: string
  igHandle?: string | null
  igProfileName?: string | null
  igProfilePictureUrl?: string | null
  lastInboundAt?: Date | null
  prospectId?: string | null
  patientId?: string | null
}): Promise<{ id: string; isNew: boolean }> {
  // PostgreSQL trick: `xmax = 0` on the returned row means the row was just inserted
  // (no row version was overwritten). On UPDATE branch of ON CONFLICT, xmax is non-zero.
  const now = new Date()
  const insertValues = {
    tenantId: opts.tenantId,
    igsid: opts.igsid,
    igHandle: opts.igHandle ?? null,
    igProfileName: opts.igProfileName ?? null,
    igProfilePictureUrl: opts.igProfilePictureUrl ?? null,
    prospectId: opts.prospectId ?? null,
    patientId: opts.patientId ?? null,
    lastMessageAt: now,
    lastInboundAt: opts.lastInboundAt ?? null,
    updatedAt: now,
  }

  // We need to coalesce optional fields so an upsert that omits a value doesn't
  // wipe existing data on the row. Only explicitly provided values overwrite.
  const updateSet: Record<string, unknown> = {
    lastMessageAt: now,
    updatedAt: now,
  }
  if (opts.igHandle !== undefined) updateSet.igHandle = opts.igHandle
  if (opts.igProfileName !== undefined) updateSet.igProfileName = opts.igProfileName
  if (opts.igProfilePictureUrl !== undefined) updateSet.igProfilePictureUrl = opts.igProfilePictureUrl
  if (opts.prospectId !== undefined) updateSet.prospectId = opts.prospectId
  if (opts.patientId !== undefined) updateSet.patientId = opts.patientId
  if (opts.lastInboundAt !== undefined && opts.lastInboundAt !== null) {
    updateSet.lastInboundAt = opts.lastInboundAt
  }

  const rows = await db
    .insert(instagramConversations)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [instagramConversations.tenantId, instagramConversations.igsid] as never,
      set: updateSet,
    })
    .returning({
      id: instagramConversations.id,
      isNew: sql<boolean>`(xmax = 0)`,
    })

  const row = rows[0]!
  return { id: row.id, isNew: row.isNew }
}

export async function getConversationById(
  tenantId: string,
  id: string,
): Promise<InstagramConversation | null> {
  const [row] = await db
    .select()
    .from(instagramConversations)
    .where(
      and(
        eq(instagramConversations.id, id),
        eq(instagramConversations.tenantId, tenantId),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function getConversationByIgsid(
  tenantId: string,
  igsid: string,
): Promise<InstagramConversation | null> {
  const [row] = await db
    .select()
    .from(instagramConversations)
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.igsid, igsid),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function listConversations(
  tenantId: string,
  {
    search = '',
    filter = 'all',
    page = 1,
    pageSize = 20,
  }: { search?: string; filter?: string; page?: number; pageSize?: number },
): Promise<PaginatedResult<InstagramConversation>> {
  const offset = (page - 1) * pageSize

  const conditions = [eq(instagramConversations.tenantId, tenantId)]

  const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  if (escaped) {
    conditions.push(
      or(
        ilike(instagramConversations.igHandle, `%${escaped}%`),
        ilike(instagramConversations.igProfileName, `%${escaped}%`),
      )!,
    )
  }

  if (filter === 'unread') {
    conditions.push(gt(instagramConversations.unreadCount, 0))
  } else if (filter === 'prospects') {
    conditions.push(isNotNull(instagramConversations.prospectId))
  } else if (filter === 'patients') {
    conditions.push(isNotNull(instagramConversations.patientId))
  }

  const whereConditions = and(...conditions)

  const [conversations, countResult] = await Promise.all([
    db
      .select()
      .from(instagramConversations)
      .where(whereConditions)
      .orderBy(desc(instagramConversations.lastMessageAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(instagramConversations)
      .where(whereConditions),
  ])

  const total = countResult[0]?.count ?? 0
  const convIds = conversations.map((c) => c.id)

  // Pull the most recent message per conversation for last-message preview,
  // mirroring the WhatsApp listConversations implementation.
  const lastMsgMap = new Map<
    string,
    { body: string; direction: string; deliveryStatus: string }
  >()
  if (convIds.length > 0) {
    const lastMsgs = await db
      .selectDistinctOn([instagramMessages.conversationId], {
        conversationId: instagramMessages.conversationId,
        body: instagramMessages.body,
        mediaType: instagramMessages.mediaType,
        mediaFilename: instagramMessages.mediaFilename,
        direction: instagramMessages.direction,
        deliveryStatus: instagramMessages.deliveryStatus,
      })
      .from(instagramMessages)
      .where(inArray(instagramMessages.conversationId, convIds))
      .orderBy(instagramMessages.conversationId, desc(instagramMessages.timestamp))

    const mediaLabels: Record<string, string> = {
      image: 'Imagem',
      video: 'Video',
      audio: 'Audio',
      file: 'Arquivo',
    }
    for (const m of lastMsgs) {
      const display =
        m.body ||
        (m.mediaType
          ? mediaLabels[m.mediaType] ?? m.mediaFilename ?? m.mediaType
          : null)
      if (display) {
        lastMsgMap.set(m.conversationId, {
          body: display,
          direction: m.direction,
          deliveryStatus: m.deliveryStatus,
        })
      }
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
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function markConversationRead(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.id, conversationId),
        eq(instagramConversations.tenantId, tenantId),
      ),
    )
}

export async function linkPatient(
  tenantId: string,
  conversationId: string,
  patientId: string,
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ patientId, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.id, conversationId),
        eq(instagramConversations.tenantId, tenantId),
      ),
    )
}

export async function unlinkPatient(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ patientId: null, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.id, conversationId),
        eq(instagramConversations.tenantId, tenantId),
      ),
    )
}

export async function incrementUnreadCount(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  // NOTE: do not write lastInboundAt here — upsertConversation already
  // sets it from the event timestamp. Overwriting with NOW() would clobber
  // the source-of-truth value carried in the webhook payload.
  const now = new Date()
  await db
    .update(instagramConversations)
    .set({
      unreadCount: sql`${instagramConversations.unreadCount} + 1`,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(instagramConversations.id, conversationId),
        eq(instagramConversations.tenantId, tenantId),
      ),
    )
}

// ─── MESSAGES ──────────────────────────────────────────────────────

export async function createMessage(opts: {
  tenantId: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  messageType?: string
  metaMessageId?: string | null
  body?: string | null
  mediaType?: string | null
  mediaUrl?: string | null
  mediaFilename?: string | null
  storyMediaUrl?: string | null
  storyId?: string | null
  reactionEmoji?: string | null
  reactsToMessageId?: string | null
  deliveryStatus?: string
  messageTag?: string | null
  errorCode?: string | null
  timestamp?: Date
}): Promise<InstagramMessage> {
  const [msg] = await db
    .insert(instagramMessages)
    .values({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      direction: opts.direction,
      messageType: opts.messageType ?? 'text',
      metaMessageId: opts.metaMessageId ?? null,
      body: opts.body ?? null,
      mediaType: opts.mediaType ?? null,
      mediaUrl: opts.mediaUrl ?? null,
      mediaFilename: opts.mediaFilename ?? null,
      storyMediaUrl: opts.storyMediaUrl ?? null,
      storyId: opts.storyId ?? null,
      reactionEmoji: opts.reactionEmoji ?? null,
      reactsToMessageId: opts.reactsToMessageId ?? null,
      deliveryStatus: opts.deliveryStatus ?? 'sent',
      messageTag: opts.messageTag ?? null,
      errorCode: opts.errorCode ?? null,
      timestamp: opts.timestamp ?? new Date(),
    })
    .returning()

  return msg
}

export async function getMessageByMetaId(
  tenantId: string,
  metaMessageId: string,
): Promise<InstagramMessage | null> {
  const [row] = await db
    .select()
    .from(instagramMessages)
    .where(
      and(
        eq(instagramMessages.tenantId, tenantId),
        eq(instagramMessages.metaMessageId, metaMessageId),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function getMessageById(
  tenantId: string,
  id: string,
): Promise<InstagramMessage | null> {
  const [row] = await db
    .select()
    .from(instagramMessages)
    .where(
      and(
        eq(instagramMessages.tenantId, tenantId),
        eq(instagramMessages.id, id),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function listMessages(
  conversationId: string,
  { page = 1, pageSize = 50 }: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<InstagramMessage>> {
  const offset = (page - 1) * pageSize

  const whereConditions = eq(instagramMessages.conversationId, conversationId)

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(instagramMessages)
      .where(whereConditions)
      .orderBy(desc(instagramMessages.timestamp))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(instagramMessages)
      .where(whereConditions),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    data: data.reverse(),
    total,
    page,
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function updateMessageStatus(
  tenantId: string,
  metaMessageId: string,
  status: string,
  errorCode?: string | null,
): Promise<InstagramMessage | null> {
  const [updated] = await db
    .update(instagramMessages)
    .set({
      deliveryStatus: status,
      ...(errorCode !== undefined ? { errorCode } : {}),
    })
    .where(
      and(
        eq(instagramMessages.tenantId, tenantId),
        eq(instagramMessages.metaMessageId, metaMessageId),
      ),
    )
    .returning()

  return updated ?? null
}

export async function markOutboundDeliveredUpToWatermark(
  tenantId: string,
  conversationId: string,
  watermark: Date,
  newStatus: 'delivered' | 'read',
): Promise<number> {
  // Update outbound messages whose timestamp <= watermark and whose delivery status
  // is not already the target (and not 'failed'). Returns the row count touched.
  const updated = await db
    .update(instagramMessages)
    .set({ deliveryStatus: newStatus })
    .where(
      and(
        eq(instagramMessages.tenantId, tenantId),
        eq(instagramMessages.conversationId, conversationId),
        eq(instagramMessages.direction, 'outbound'),
        sql`${instagramMessages.timestamp} <= ${watermark}`,
        ne(instagramMessages.deliveryStatus, newStatus),
        ne(instagramMessages.deliveryStatus, 'failed'),
      ),
    )
    .returning({ id: instagramMessages.id })

  return updated.length
}

export async function getRecentInboundBodies(
  tenantId: string,
  conversationId: string,
  limit = 5,
  after?: Date,
): Promise<string[]> {
  const conditions = [
    eq(instagramMessages.tenantId, tenantId),
    eq(instagramMessages.conversationId, conversationId),
    eq(instagramMessages.direction, 'inbound'),
    sql`${instagramMessages.body} IS NOT NULL AND ${instagramMessages.body} <> ''`,
  ]
  if (after) {
    conditions.push(gte(instagramMessages.timestamp, after))
  }

  const rows = await db
    .select({ body: instagramMessages.body })
    .from(instagramMessages)
    .where(and(...conditions))
    .orderBy(desc(instagramMessages.timestamp))
    .limit(limit)

  return rows.map((r) => r.body!).reverse()
}

export async function deleteInboundReaction(
  conversationId: string,
  reactsToMessageId: string,
  emoji?: string,
): Promise<void> {
  // v1 no-op semantics per plan; we delete inbound reaction rows that match.
  // Kept minimal — caller in C1 may choose not to invoke this.
  const conditions = [
    eq(instagramMessages.conversationId, conversationId),
    eq(instagramMessages.direction, 'inbound'),
    eq(instagramMessages.messageType, 'reaction'),
    eq(instagramMessages.reactsToMessageId, reactsToMessageId),
  ]
  if (emoji) {
    conditions.push(eq(instagramMessages.reactionEmoji, emoji))
  }

  await db.delete(instagramMessages).where(and(...conditions))
}

// ─── PROSPECT LOOKUP ──────────────────────────────────────────────

export async function getProspectByIgsid(
  tenantId: string,
  igsid: string,
): Promise<{ id: string; stage: string; createdAt: Date } | null> {
  // Return the most recent active (non-terminal) prospect for this IGSID.
  // Mirrors getProspectByPhone's effective behavior given the partial unique
  // index uq_prospects_tenant_igsid_active (which excludes terminal stages).
  const [row] = await db
    .select({
      id: prospects.id,
      stage: prospects.stage,
      createdAt: prospects.createdAt,
    })
    .from(prospects)
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        eq(prospects.igsid, igsid),
        isNull(prospects.deletedAt),
        sql`${prospects.stage} NOT IN ('convertido', 'perdido')`,
      ),
    )
    .orderBy(desc(prospects.createdAt))
    .limit(1)

  return row ?? null
}

// ─── SAVED REPLIES ────────────────────────────────────────────────

export async function listSavedReplies(
  tenantId: string,
): Promise<InstagramSavedReply[]> {
  return db
    .select()
    .from(instagramSavedReplies)
    .where(
      and(
        eq(instagramSavedReplies.tenantId, tenantId),
        isNull(instagramSavedReplies.archivedAt),
      ),
    )
    .orderBy(instagramSavedReplies.name)
}

export async function getSavedReplyById(
  tenantId: string,
  id: string,
): Promise<InstagramSavedReply | null> {
  const [row] = await db
    .select()
    .from(instagramSavedReplies)
    .where(
      and(
        eq(instagramSavedReplies.id, id),
        eq(instagramSavedReplies.tenantId, tenantId),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function createSavedReply(
  tenantId: string,
  input: {
    name: string
    body: string
    variableKeys?: string[]
    purposeKey?: string | null
  },
): Promise<InstagramSavedReply> {
  const [created] = await db
    .insert(instagramSavedReplies)
    .values({
      tenantId,
      name: input.name,
      body: input.body,
      variableKeys: input.variableKeys ?? [],
      purposeKey: input.purposeKey ?? null,
    })
    .returning()

  return created
}

export async function updateSavedReply(
  tenantId: string,
  id: string,
  input: {
    name?: string
    body?: string
    variableKeys?: string[]
    purposeKey?: string | null
  },
): Promise<InstagramSavedReply | null> {
  const updateSet: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updateSet.name = input.name
  if (input.body !== undefined) updateSet.body = input.body
  if (input.variableKeys !== undefined) updateSet.variableKeys = input.variableKeys
  if (input.purposeKey !== undefined) updateSet.purposeKey = input.purposeKey

  const [updated] = await db
    .update(instagramSavedReplies)
    .set(updateSet)
    .where(
      and(
        eq(instagramSavedReplies.id, id),
        eq(instagramSavedReplies.tenantId, tenantId),
      ),
    )
    .returning()

  return updated ?? null
}

export async function archiveSavedReply(
  tenantId: string,
  id: string,
): Promise<void> {
  await db
    .update(instagramSavedReplies)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(instagramSavedReplies.id, id),
        eq(instagramSavedReplies.tenantId, tenantId),
      ),
    )
}

// ─── SSE — INSTAGRAM CHANNEL WRAPPER ─────────────────────────────

export async function pushSseEvent(
  tenantId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await pushSseEventChannel(tenantId, eventType, payload, 'instagram')
}


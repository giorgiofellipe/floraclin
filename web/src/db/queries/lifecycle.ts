import { db } from '@/db/client'
import {
  tenants,
  tenantLifecycleClicks,
  tenantLifecycleMessages,
  tenantLifecycleReplies,
  whatsappConversations,
} from '@/db/schema'
import { rowsFromExecuteResult } from '@/db/queries/admin-tenants'
import { brToday, startOfBrDay } from '@/lib/dates'
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'

export type LifecycleChannel = 'whatsapp' | 'email'
export type LifecycleSendStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type LifecycleDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface LifecycleRecipient {
  tenantId: string
  tenantName: string
  tenantPhone: string | null
  ownerName: string
  ownerEmail: string
}

interface RecipientRow {
  tenant_id: string
  tenant_name: string
  tenant_phone: string | null
  owner_name: string
  owner_email: string
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export async function findLifecycleRecipients(filter?: {
  tenantId?: string
  ownerEmail?: string
}): Promise<LifecycleRecipient[]> {
  const tenantClause = filter?.tenantId ? sql`and t.id = ${filter.tenantId}` : sql.empty()
  const emailClause = filter?.ownerEmail
    ? sql`and lower(o.email) = lower(${filter.ownerEmail})`
    : sql.empty()

  const result = await db.execute(sql`
    select t.id as tenant_id, t.name as tenant_name, t.phone as tenant_phone,
           o.full_name as owner_name, o.email as owner_email
    from floraclin.tenants t
    join floraclin.tenant_subscriptions s on s.tenant_id = t.id
    join lateral (
      select u.full_name, u.email, u.email_verified
      from floraclin.tenant_users tu join floraclin.users u on u.id = tu.user_id
      where tu.tenant_id = t.id and tu.role = 'owner' and tu.is_active
      order by tu.created_at asc limit 1
    ) o on true
    where t.lifecycle_notice_at is not null
      and t.status = 'active'
      and t.deleted_at is null
      and o.email_verified is not null
      and (s.status = 'trialing'
           or (s.status = 'expired' and s.source = 'trial' and s.current_period_end > now() - interval '10 days'))
      ${tenantClause}
      ${emailClause}
    order by t.created_at asc
  `)

  return rowsFromExecuteResult<RecipientRow>(result).map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantPhone: row.tenant_phone,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
  }))
}

// A key is done when both channels have a row that is terminal or a pending
// claim older than 1 hour, which is never retried (at most once delivery).
export async function getCompletedLifecycleKeys(tenantId: string): Promise<Set<string>> {
  const result = await db.execute(sql`
    select message_key from floraclin.tenant_lifecycle_messages
    where tenant_id = ${tenantId}
      and (status <> 'pending' or claimed_at < now() - interval '1 hour')
    group by message_key having count(distinct channel) = 2
  `)
  return new Set(rowsFromExecuteResult<{ message_key: string }>(result).map((r) => r.message_key))
}

export async function claimLifecycleSend(row: {
  tenantId: string
  messageKey: string
  channel: LifecycleChannel
  recipient: string
}): Promise<string | null> {
  const result = await db.execute(sql`
    insert into floraclin.tenant_lifecycle_messages (tenant_id, message_key, channel, status, recipient)
    values (${row.tenantId}, ${row.messageKey}, ${row.channel}, 'pending', ${row.recipient})
    on conflict (tenant_id, message_key, channel) do nothing
    returning id
  `)
  const [claimed] = rowsFromExecuteResult<{ id: string }>(result)
  return claimed?.id ?? null
}

export async function finishLifecycleSend(
  id: string,
  result: {
    status: 'sent' | 'failed'
    metaMessageId?: string
    providerMessageId?: string
    error?: string
  },
): Promise<void> {
  await db
    .update(tenantLifecycleMessages)
    .set({
      status: result.status,
      completedAt: sql`now()`,
      metaMessageId: result.metaMessageId ?? null,
      providerMessageId: result.providerMessageId ?? null,
      error: result.error ?? null,
    })
    .where(and(eq(tenantLifecycleMessages.id, id), eq(tenantLifecycleMessages.status, 'pending')))
}

export async function recordSkippedLifecycleSend(row: {
  tenantId: string
  messageKey: string
  channel: LifecycleChannel
  recipient: string
  reason: string
}): Promise<string | null> {
  const [inserted] = await db
    .insert(tenantLifecycleMessages)
    .values({
      tenantId: row.tenantId,
      messageKey: row.messageKey,
      channel: row.channel,
      status: 'skipped',
      recipient: row.recipient,
      completedAt: sql`now()`,
      error: row.reason,
    })
    .onConflictDoNothing()
    .returning({ id: tenantLifecycleMessages.id })
  // Null when the row already existed (conflict): nothing was recorded now.
  return inserted?.id ?? null
}

/**
 * True when `id` is the first WhatsApp `template_not_approved` skip recorded
 * for this key on the current BR calendar day, across every instance. Lets
 * the not-approved alert fire once a day per message key without a table of its own.
 */
export async function isFirstTemplateNotApprovedSkipToday(messageKey: string, id: string): Promise<boolean> {
  const m = tenantLifecycleMessages
  const [first] = await db
    .select({ id: m.id })
    .from(m)
    .where(
      and(
        eq(m.messageKey, messageKey),
        eq(m.channel, 'whatsapp'),
        eq(m.status, 'skipped'),
        eq(m.error, 'template_not_approved'),
        gte(m.claimedAt, startOfBrDay(brToday())),
      ),
    )
    .orderBy(asc(m.claimedAt), asc(m.id))
    .limit(1)
  return first?.id === id
}

export async function findLifecycleSendByMetaId(metaMessageId: string): Promise<{
  tenantId: string
  tenantName: string
  messageKey: string
  recipient: string
} | null> {
  const [row] = await db
    .select({
      tenantId: tenantLifecycleMessages.tenantId,
      tenantName: tenants.name,
      messageKey: tenantLifecycleMessages.messageKey,
      recipient: tenantLifecycleMessages.recipient,
    })
    .from(tenantLifecycleMessages)
    .innerJoin(tenants, eq(tenants.id, tenantLifecycleMessages.tenantId))
    .where(
      and(
        eq(tenantLifecycleMessages.metaMessageId, metaMessageId),
        eq(tenantLifecycleMessages.channel, 'whatsapp'),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface LifecycleClickSend {
  id: string
  tenantId: string
  messageKey: string
  channel: LifecycleChannel
}

export async function findLifecycleSendForClick(id: string): Promise<LifecycleClickSend | null> {
  const [row] = await db
    .select({
      id: tenantLifecycleMessages.id,
      tenantId: tenantLifecycleMessages.tenantId,
      messageKey: tenantLifecycleMessages.messageKey,
      channel: tenantLifecycleMessages.channel,
    })
    .from(tenantLifecycleMessages)
    .where(eq(tenantLifecycleMessages.id, id))
    .limit(1)
  return row ? { ...row, channel: row.channel as LifecycleChannel } : null
}

export async function findRecentLifecycleTenantsByPhone(
  phone: string,
  since: Date,
): Promise<{ tenantId: string; tenantName: string; messageKey: string }[]> {
  return db
    .selectDistinctOn([tenantLifecycleMessages.tenantId], {
      tenantId: tenantLifecycleMessages.tenantId,
      tenantName: tenants.name,
      messageKey: tenantLifecycleMessages.messageKey,
    })
    .from(tenantLifecycleMessages)
    .innerJoin(tenants, eq(tenants.id, tenantLifecycleMessages.tenantId))
    .where(
      and(
        eq(tenantLifecycleMessages.channel, 'whatsapp'),
        eq(tenantLifecycleMessages.status, 'sent'),
        eq(tenantLifecycleMessages.recipient, phone),
        gte(tenantLifecycleMessages.claimedAt, since),
      ),
    )
    .orderBy(tenantLifecycleMessages.tenantId, desc(tenantLifecycleMessages.claimedAt))
}

export async function hasRecentConversationForPhone(phone: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: whatsappConversations.id })
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.phoneNumber, phone),
        gte(whatsappConversations.lastMessageAt, since),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function updateLifecycleDeliveryStatusByMetaId(
  metaMessageId: string,
  update: {
    status: LifecycleDeliveryStatus
    at: Date
    errorCode?: string | null
    error?: string | null
  },
): Promise<boolean> {
  const m = tenantLifecycleMessages
  const updated = await db
    .update(m)
    .set(deliveryUpdate(update))
    .where(and(eq(m.metaMessageId, metaMessageId), eq(m.channel, 'whatsapp')))
    .returning({ id: m.id })
  return updated.length > 0
}

// Meta does not order status webhooks, so each status only fills its own timestamp once.
function deliveryUpdate(update: {
  status: LifecycleDeliveryStatus
  at: Date
  errorCode?: string | null
  error?: string | null
}): PgUpdateSetSource<typeof tenantLifecycleMessages> {
  const m = tenantLifecycleMessages
  const at = sql`${update.at.toISOString()}::timestamptz`
  switch (update.status) {
    case 'failed':
      return { status: 'failed', errorCode: update.errorCode ?? null, error: update.error ?? 'failed' }
    case 'sent':
      return { completedAt: sql`coalesce(${m.completedAt}, ${at})` }
    case 'delivered':
      return { deliveredAt: sql`coalesce(${m.deliveredAt}, ${at})` }
    case 'read':
      return {
        deliveredAt: sql`coalesce(${m.deliveredAt}, ${at})`,
        readAt: sql`coalesce(${m.readAt}, ${at})`,
      }
  }
}

const CLICK_DEDUPE_WINDOW = sql`interval '1 hour'`

/** Returns false when the same send already has a click inside the dedupe window. */
export async function recordLifecycleClick(send: { id: string; tenantId: string }): Promise<boolean> {
  const c = tenantLifecycleClicks
  const result = await db.execute(sql`
    insert into ${c} (${sql.identifier(c.tenantId.name)}, ${sql.identifier(c.lifecycleMessageId.name)})
    select ${send.tenantId}, ${send.id}
    where not exists (
      select 1 from ${c}
      where ${c.lifecycleMessageId} = ${send.id} and ${c.createdAt} > now() - ${CLICK_DEDUPE_WINDOW}
    )
    returning ${c.id}
  `)
  return rowsFromExecuteResult(result).length > 0
}

export async function isTenantLifecycleOptedOut(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ optedOutAt: tenants.lifecycleOptedOutAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return row?.optedOutAt != null
}

export async function insertLifecycleReply(row: {
  tenantId: string
  messageKey: string
  body: string
  metaMessageId: string
}): Promise<boolean> {
  const inserted = await db
    .insert(tenantLifecycleReplies)
    .values(row)
    .onConflictDoNothing({ target: tenantLifecycleReplies.metaMessageId })
    .returning({ id: tenantLifecycleReplies.id })
  return inserted.length > 0
}

export async function getLifecycleHistory(tenantId: string): Promise<{
  sends: {
    messageKey: string
    channel: string
    status: string
    claimedAt: string
    error: string | null
  }[]
  replies: { messageKey: string; body: string; receivedAt: string }[]
}> {
  const [sends, replies] = await Promise.all([
    db
      .select({
        messageKey: tenantLifecycleMessages.messageKey,
        channel: tenantLifecycleMessages.channel,
        status: tenantLifecycleMessages.status,
        claimedAt: tenantLifecycleMessages.claimedAt,
        error: tenantLifecycleMessages.error,
      })
      .from(tenantLifecycleMessages)
      .where(eq(tenantLifecycleMessages.tenantId, tenantId))
      .orderBy(desc(tenantLifecycleMessages.claimedAt))
      .limit(50),
    db
      .select({
        messageKey: tenantLifecycleReplies.messageKey,
        body: tenantLifecycleReplies.body,
        receivedAt: tenantLifecycleReplies.receivedAt,
      })
      .from(tenantLifecycleReplies)
      .where(eq(tenantLifecycleReplies.tenantId, tenantId))
      .orderBy(desc(tenantLifecycleReplies.receivedAt))
      .limit(50),
  ])

  return {
    sends: sends.map((s) => ({ ...s, claimedAt: toIso(s.claimedAt) })),
    replies: replies.map((r) => ({ ...r, receivedAt: toIso(r.receivedAt) })),
  }
}

import { db } from '@/db/client'
import {
  tenants,
  tenantLifecycleMessages,
  tenantLifecycleReplies,
  whatsappConversations,
} from '@/db/schema'
import { rowsFromExecuteResult } from '@/db/queries/admin-tenants'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

export type LifecycleChannel = 'whatsapp' | 'email'
export type LifecycleSendStatus = 'pending' | 'sent' | 'failed' | 'skipped'

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
  result: { status: 'sent' | 'failed'; metaMessageId?: string; error?: string },
): Promise<void> {
  await db
    .update(tenantLifecycleMessages)
    .set({
      status: result.status,
      completedAt: sql`now()`,
      metaMessageId: result.metaMessageId ?? null,
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
}): Promise<void> {
  await db
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

export async function markLifecycleSendFailedByMetaId(
  metaMessageId: string,
  error: string,
): Promise<boolean> {
  const updated = await db
    .update(tenantLifecycleMessages)
    .set({ status: 'failed', error })
    .where(eq(tenantLifecycleMessages.metaMessageId, metaMessageId))
    .returning({ id: tenantLifecycleMessages.id })
  return updated.length > 0
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
  sends: { messageKey: string; channel: string; status: string; claimedAt: string; error: string | null }[]
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

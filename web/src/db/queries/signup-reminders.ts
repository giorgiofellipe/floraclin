import { db } from '@/db/client'
import { rowsFromExecuteResult } from '@/db/queries/admin-tenants'
import { sql, type SQL } from 'drizzle-orm'

export const SIGNUP_CONFIRM_REMINDER_KEY = 'signup_confirm_reminder'
export const SIGNUP_FINISH_REMINDER_KEY = 'signup_finish_reminder'

const REMINDER_MIN_AGE = '1 hour'
// Also caps retries of a failed send.
const REMINDER_MAX_AGE = '7 days'

export interface SignupReminderRecipient {
  tenantId: string
  tenantName: string
  ownerEmail: string
}

interface RecipientRow {
  tenant_id: string
  tenant_name: string
  owner_email: string
}

async function findRecipients(messageKey: string, ownerClause: SQL) {
  const result = await db.execute(sql`
    select t.id as tenant_id, t.name as tenant_name, o.email as owner_email
    from floraclin.tenants t
    join lateral (
      select u.email, u.email_verified, u.password_hash
      from floraclin.tenant_users tu join floraclin.users u on u.id = tu.user_id
      where tu.tenant_id = t.id and tu.role = 'owner' and tu.is_active
      order by tu.created_at asc limit 1
    ) o on true
    where t.status = 'active'
      and t.deleted_at is null
      and t.created_at <= now() - ${REMINDER_MIN_AGE}::interval
      and t.created_at > now() - ${REMINDER_MAX_AGE}::interval
      and not exists (
        select 1 from floraclin.tenant_lifecycle_messages m
        where m.tenant_id = t.id and m.message_key = ${messageKey} and m.channel = 'email'
          and m.status <> 'failed'
      )
      ${ownerClause}
    order by t.created_at asc
  `)

  return rowsFromExecuteResult<RecipientRow>(result).map(
    (row): SignupReminderRecipient => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      ownerEmail: row.owner_email,
    }),
  )
}

export function findConfirmReminderRecipients(): Promise<SignupReminderRecipient[]> {
  return findRecipients(
    SIGNUP_CONFIRM_REMINDER_KEY,
    sql`and o.password_hash is not null and o.email_verified is null`,
  )
}

// Clinics with lifecycle_notice_at set are reached by the trial lifecycle instead.
export function findFinishReminderRecipients(): Promise<SignupReminderRecipient[]> {
  return findRecipients(
    SIGNUP_FINISH_REMINDER_KEY,
    sql`and o.email_verified is not null
        and t.lifecycle_notice_at is null
        and coalesce(t.settings, '{}'::jsonb) -> 'onboarding_completed' is distinct from 'true'::jsonb`,
  )
}

// Takes over a failed row so the next run retries it. A pending row is never
// taken over: its send may have gone out before the run died.
export async function claimSignupReminder(row: {
  tenantId: string
  messageKey: string
  recipient: string
}): Promise<string | null> {
  const result = await db.execute(sql`
    insert into floraclin.tenant_lifecycle_messages (tenant_id, message_key, channel, status, recipient)
    values (${row.tenantId}, ${row.messageKey}, 'email', 'pending', ${row.recipient})
    on conflict (tenant_id, message_key, channel) do update
      set status = 'pending', recipient = excluded.recipient, claimed_at = now(),
          completed_at = null, error = null, provider_message_id = null
      where floraclin.tenant_lifecycle_messages.status = 'failed'
    returning id
  `)
  const [claimed] = rowsFromExecuteResult<{ id: string }>(result)
  return claimed?.id ?? null
}

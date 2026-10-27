import { NextResponse } from 'next/server'
import { finishLifecycleSend } from '@/db/queries/lifecycle'
import {
  claimSignupReminder,
  findConfirmReminderRecipients,
  findFinishReminderRecipients,
  SIGNUP_CONFIRM_REMINDER_KEY,
  SIGNUP_FINISH_REMINDER_KEY,
  type SignupReminderRecipient,
} from '@/db/queries/signup-reminders'
import { handleApiError } from '@/lib/api-error'
import { getOrIssueConfirmationUrl } from '@/lib/confirm-email'
import { withCronMonitor } from '@/lib/cron-monitor'
import { sendConfirmationReminderEmail, sendFinishSetupReminderEmail } from '@/lib/email'
import { reportSideEffectFailure } from '@/lib/observability'

export const maxDuration = 300

// Schedule mirrors `vercel.json`; see withCronMonitor for the rest.
const MONITOR_SLUG = 'signup-reminders'
const MONITOR_SCHEDULE = '0 * * * *'

type Outcome = {
  tenantId: string
  key: string
  result: 'sent' | 'already_claimed' | 'failed' | 'tenant_error'
}

async function sendOnce(
  recipient: SignupReminderRecipient,
  key: string,
  send: () => Promise<{ id: string }>,
): Promise<Outcome['result']> {
  const id = await claimSignupReminder({
    tenantId: recipient.tenantId,
    messageKey: key,
    recipient: recipient.ownerEmail,
  })
  if (!id) return 'already_claimed'
  try {
    const sent = await send()
    await finishLifecycleSend(id, { status: 'sent', providerMessageId: sent.id })
    return 'sent'
  } catch (err) {
    reportSideEffectFailure(err, {
      area: 'signup-reminders',
      step: key,
      extra: { tenantId: recipient.tenantId },
    })
    await finishLifecycleSend(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    return 'failed'
  }
}

function sendConfirmReminder(recipient: SignupReminderRecipient) {
  return sendOnce(recipient, SIGNUP_CONFIRM_REMINDER_KEY, async () =>
    sendConfirmationReminderEmail(
      recipient.ownerEmail,
      await getOrIssueConfirmationUrl(recipient.ownerEmail),
      recipient.tenantName,
    ),
  )
}

function sendFinishReminder(recipient: SignupReminderRecipient) {
  return sendOnce(recipient, SIGNUP_FINISH_REMINDER_KEY, () => sendFinishSetupReminderEmail(recipient.ownerEmail))
}

async function run() {
  const batches = [
    { key: SIGNUP_CONFIRM_REMINDER_KEY, recipients: await findConfirmReminderRecipients(), send: sendConfirmReminder },
    { key: SIGNUP_FINISH_REMINDER_KEY, recipients: await findFinishReminderRecipients(), send: sendFinishReminder },
  ]
  const outcomes: Outcome[] = []

  for (const { key, recipients, send } of batches) {
    for (const recipient of recipients) {
      try {
        outcomes.push({ tenantId: recipient.tenantId, key, result: await send(recipient) })
      } catch (err) {
        reportSideEffectFailure(err, {
          area: 'signup-reminders',
          step: 'cron_tenant',
          extra: { tenantId: recipient.tenantId, key },
        })
        outcomes.push({ tenantId: recipient.tenantId, key, result: 'tenant_error' })
      }
    }
  }

  // Vercel discards the response body, so this log is the operational record.
  console.log('[signup-reminders]', JSON.stringify({ processed: outcomes.length, outcomes }))
  return { ok: true, processed: outcomes.length, outcomes }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, run)
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, request)
  }
}

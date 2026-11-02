import { NextResponse } from 'next/server'
import { finishLifecycleSend } from '@/db/queries/lifecycle'
import {
  claimSignupReminder,
  findConfirmReminderRecipients,
  findFinalConfirmReminderRecipients,
  findFinishReminderRecipients,
  SIGNUP_CONFIRM_FINAL_REMINDER_KEY,
  SIGNUP_CONFIRM_REMINDER_KEY,
  SIGNUP_FINISH_REMINDER_KEY,
  type SignupReminderRecipient,
} from '@/db/queries/signup-reminders'
import { handleApiError } from '@/lib/api-error'
import { getOrIssueConfirmationUrl, MIN_LINK_VALIDITY_MS } from '@/lib/confirm-email'
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

// The 24 hour reminder comes about when the signup link expires, so a link
// with under MIN_LINK_VALIDITY_MS left is replaced rather than resent.
function confirmReminder(key: string, reminder: 'first' | 'last') {
  return (recipient: SignupReminderRecipient) =>
    sendOnce(recipient, key, async () =>
      sendConfirmationReminderEmail(
        recipient.ownerEmail,
        await getOrIssueConfirmationUrl(recipient.ownerEmail, MIN_LINK_VALIDITY_MS),
        recipient.tenantName,
        reminder,
      ),
    )
}

const sendConfirmReminder = confirmReminder(SIGNUP_CONFIRM_REMINDER_KEY, 'first')
const sendFinalConfirmReminder = confirmReminder(SIGNUP_CONFIRM_FINAL_REMINDER_KEY, 'last')

function sendFinishReminder(recipient: SignupReminderRecipient) {
  return sendOnce(recipient, SIGNUP_FINISH_REMINDER_KEY, () => sendFinishSetupReminderEmail(recipient.ownerEmail))
}

async function run() {
  // Each batch is looked up only after the one before it was sent: a clinic
  // turning 24 hours old between the lookups would otherwise be in both confirm
  // batches, and the final one's 12 hour gap only sees a first reminder once
  // it has been claimed.
  const batches = [
    { key: SIGNUP_CONFIRM_REMINDER_KEY, find: findConfirmReminderRecipients, send: sendConfirmReminder },
    { key: SIGNUP_CONFIRM_FINAL_REMINDER_KEY, find: findFinalConfirmReminderRecipients, send: sendFinalConfirmReminder },
    { key: SIGNUP_FINISH_REMINDER_KEY, find: findFinishReminderRecipients, send: sendFinishReminder },
  ]
  const outcomes: Outcome[] = []

  for (const { key, find, send } of batches) {
    for (const recipient of await find()) {
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

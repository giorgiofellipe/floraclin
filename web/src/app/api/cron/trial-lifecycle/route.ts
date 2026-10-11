import { NextResponse } from 'next/server'
import { findLifecycleRecipients, getCompletedLifecycleKeys } from '@/db/queries/lifecycle'
import { getActivationState } from '@/lib/activation'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'
import { deliverLifecycleMessage, isLifecycleEnabled, type ChannelOutcome } from '@/lib/lifecycle-sender'
import { selectDueMessages } from '@/lib/lifecycle-messages'
import { reportSideEffectFailure } from '@/lib/observability'

export const maxDuration = 300

// Schedule mirrors `vercel.json`; see withCronMonitor for the rest.
const MONITOR_SLUG = 'trial-lifecycle'
// 13:00 UTC is 10:00 BRT; Vercel crons run in UTC.
const MONITOR_SCHEDULE = '0 13 * * *'

type Outcome =
  | { tenantId: string; result: 'nothing_due' }
  | { tenantId: string; result: 'delivered'; key: string; whatsapp: ChannelOutcome; email: ChannelOutcome }
  | { tenantId: string; result: 'tenant_error' }

async function run() {
  if (!isLifecycleEnabled()) return { ok: true, disabled: true }

  const recipients = await findLifecycleRecipients()
  const outcomes: Outcome[] = []

  for (const recipient of recipients) {
    try {
      const state = await getActivationState(recipient.tenantId)
      const due = state
        ? selectDueMessages(state, await getCompletedLifecycleKeys(recipient.tenantId))
        : []
      if (due.length === 0) {
        outcomes.push({ tenantId: recipient.tenantId, result: 'nothing_due' })
        continue
      }
      // One message per clinic per day, so a backlog never arrives as a burst.
      const delivery = await deliverLifecycleMessage(recipient, due[0])
      outcomes.push({ tenantId: recipient.tenantId, result: 'delivered', key: due[0].key, ...delivery })
    } catch (err) {
      reportSideEffectFailure(err, {
        area: 'lifecycle',
        step: 'cron_tenant',
        extra: { tenantId: recipient.tenantId },
      })
      outcomes.push({ tenantId: recipient.tenantId, result: 'tenant_error' })
    }
  }

  // Vercel discards the response body, so this log is the operational record.
  console.log(
    '[trial-lifecycle]',
    JSON.stringify({
      processed: recipients.length,
      outcomes: outcomes.filter((o) => o.result !== 'nothing_due'),
    }),
  )
  return { ok: true, processed: recipients.length, outcomes }
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

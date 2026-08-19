import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getExpiredTrials, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'
import { cronMonitorConfig } from '@/lib/observability'

// Schedule mirrors `vercel.json`; see cronMonitorConfig for the rest.
const MONITOR_SLUG = 'subscription-expiry'
const MONITOR_CONFIG = cronMonitorConfig('0 3 * * *')

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // A cron that stops being invoked is invisible: nothing throws, nothing
    // logs, trials just quietly stay active forever. The check-in makes the
    // absence itself the alert.
    const expired = await Sentry.withMonitor(
      MONITOR_SLUG,
      async () => {
        const expiredTrials = await getExpiredTrials()

        for (const sub of expiredTrials) {
          await updateSubscriptionStatus(sub.tenantId, 'expired')
        }

        return expiredTrials.length
      },
      MONITOR_CONFIG,
    )

    return NextResponse.json({ ok: true, expired })
  } catch (error) {
    return handleApiError(error, request)
  }
}

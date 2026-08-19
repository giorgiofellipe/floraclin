import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getExpiredTrials, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

// Schedule mirrors `vercel.json`. Vercel evaluates cron expressions in UTC,
// so the monitor has to be told the same thing or Sentry marks every run late.
const MONITOR_SLUG = 'subscription-expiry'
const MONITOR_CONFIG = {
  schedule: { type: 'crontab', value: '0 3 * * *' },
  timezone: 'Etc/UTC',
  checkinMargin: 60,
  maxRuntime: 10,
} as const

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

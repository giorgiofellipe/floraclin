import { NextResponse } from 'next/server'
import { getExpiredTrials, updateSubscriptionStatus } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'

// Schedule mirrors `vercel.json`; see withCronMonitor for the rest.
const MONITOR_SLUG = 'subscription-expiry'
const MONITOR_SCHEDULE = '0 3 * * *'

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
    const expired = await withCronMonitor(
      MONITOR_SLUG,
      MONITOR_SCHEDULE,
      async () => {
        const expiredTrials = await getExpiredTrials()

        for (const sub of expiredTrials) {
          await updateSubscriptionStatus(sub.tenantId, 'expired')
        }

        return expiredTrials.length
      },
    )

    return NextResponse.json({ ok: true, expired })
  } catch (error) {
    return handleApiError(error, request)
  }
}

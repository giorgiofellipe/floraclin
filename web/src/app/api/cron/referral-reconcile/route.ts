import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'
import { reconcileReferrals } from '@/lib/referral/events'

// Schedule mirrors `vercel.json` (04:30 BRT); see withCronMonitor for the rest.
const MONITOR_SLUG = 'referral-reconcile'
const MONITOR_SCHEDULE = '30 7 * * *'

export const maxDuration = 300
const SOFT_DEADLINE_MS = 240_000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
      reconcileReferrals({ deadlineAt: Date.now() + SOFT_DEADLINE_MS }),
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}

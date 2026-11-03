import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'
import { runNfseCron } from '@/lib/nfse/emission'

const MONITOR_SLUG = 'nfse-retry'
const MONITOR_SCHEDULE = '15 * * * *'

export const maxDuration = 300
const SOFT_DEADLINE_MS = 200_000

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
      runNfseCron(Date.now() + SOFT_DEADLINE_MS),
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}

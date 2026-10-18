import { NextResponse } from 'next/server'
import { withCronMonitor } from '@/lib/cron-monitor'
import { runTemplateAutomation } from '@/lib/whatsapp-automation-cron'
import { loadDueFollowUps } from '@/lib/whatsapp-follow-up'

// Schedule mirrors `vercel.json`: 12:30 UTC is 09:30 BRT.
const MONITOR_SLUG = 'whatsapp-follow-up'
const MONITOR_SCHEDULE = '30 12 * * *'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
    runTemplateAutomation('follow_up', loadDueFollowUps),
  )
  return NextResponse.json(result)
}

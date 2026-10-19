import { NextResponse } from 'next/server'
import { withCronMonitor } from '@/lib/cron-monitor'
import { runTemplateAutomation } from '@/lib/whatsapp-automation-cron'
import { loadDueReminders } from '@/lib/whatsapp-payment-reminder'

// Schedule mirrors `vercel.json`: 12:00 UTC is 09:00 BRT.
const MONITOR_SLUG = 'whatsapp-payment-reminder'
const MONITOR_SCHEDULE = '0 12 * * *'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
    runTemplateAutomation('payment_reminder', loadDueReminders),
  )
  return NextResponse.json(result)
}

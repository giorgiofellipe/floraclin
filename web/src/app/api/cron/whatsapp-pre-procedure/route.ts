import { NextResponse } from 'next/server'
import { withCronMonitor } from '@/lib/cron-monitor'
import { runTemplateAutomation } from '@/lib/whatsapp-automation-cron'
import { loadDuePreInstructions } from '@/lib/whatsapp-procedure-care'

// Schedule mirrors `vercel.json`: 13:30 UTC is 10:30 BRT.
const MONITOR_SLUG = 'whatsapp-pre-procedure'
const MONITOR_SCHEDULE = '30 13 * * *'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
    runTemplateAutomation('pre_procedure_instructions', loadDuePreInstructions),
  )
  return NextResponse.json(result)
}

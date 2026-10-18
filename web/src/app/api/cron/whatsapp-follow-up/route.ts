import { NextResponse } from 'next/server'
import { getProceduresDueFollowUp, markFollowUpSent } from '@/db/queries/procedures'
import { withCronMonitor } from '@/lib/cron-monitor'
import { brToday, endOfBrDay, shiftBrYmd, startOfBrDay } from '@/lib/dates'
import { runTemplateAutomation, type DueMessage, type LoadDueArgs } from '@/lib/whatsapp-automation-cron'

// Schedule mirrors `vercel.json`: 12:30 UTC is 09:30 BRT.
const MONITOR_SLUG = 'whatsapp-follow-up'
const MONITOR_SCHEDULE = '30 12 * * *'

const DEFAULT_DAYS_AFTER_PROCEDURE = 7
// Lets a missed daily run catch up, without messaging procedures from months
// ago the day a clinic turns the automation on.
const CATCH_UP_DAYS = 2

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

async function loadDueFollowUps({ tenantId, config }: LoadDueArgs): Promise<DueMessage[]> {
  const days = Number(config.daysAfterProcedure) || DEFAULT_DAYS_AFTER_PROCEDURE
  const lastDay = shiftBrYmd(brToday(), -days)
  const records = await getProceduresDueFollowUp(
    tenantId,
    startOfBrDay(shiftBrYmd(lastDay, -CATCH_UP_DAYS)),
    endOfBrDay(lastDay),
  )

  // One message per patient, even when one visit covered several procedures.
  const byPatient = new Map<string, typeof records>()
  for (const record of records) {
    byPatient.set(record.patientId, [...(byPatient.get(record.patientId) ?? []), record])
  }

  return [...byPatient.values()].map((group) => {
    const { patientId, patientName, patientPhone } = group[0]
    const procedureNames = [...new Set(group.map((r) => r.procedureTypeName))]
    return {
      ref: `procedures ${group.map((r) => r.id).join(',')}`,
      patientId,
      patientName,
      phone: patientPhone,
      params: {
        '1': patientName.split(' ')[0] || patientName,
        '2': joinPt(procedureNames),
      },
      markSent: () => markFollowUpSent(tenantId, group.map((r) => r.id)),
    }
  })
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

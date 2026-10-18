import { claimFollowUp, getProcedureTypeNames, getSessionsDueFollowUp, releaseFollowUp } from '@/db/queries/procedures'
import { brToday, endOfBrDay, shiftBrYmd, startOfBrDay } from '@/lib/dates'
import { firstName } from '@/lib/utils'
import type { DueMessage, LoadDueArgs } from '@/lib/whatsapp-automation-cron'

// Lets a missed daily run catch up, without messaging sessions from months
// ago the day a clinic turns the automation on.
const CATCH_UP_DAYS = 2

export async function loadDueFollowUps({ tenantId, config }: LoadDueArgs<'follow_up'>): Promise<DueMessage[]> {
  const lastDay = shiftBrYmd(brToday(), -config.daysAfterProcedure)
  const sessions = await getSessionsDueFollowUp(
    tenantId,
    startOfBrDay(shiftBrYmd(lastDay, -CATCH_UP_DAYS)),
    endOfBrDay(lastDay),
  )
  if (sessions.length === 0) return []

  const additionalIds = sessions.flatMap((s) => s.additionalTypeIds ?? [])
  const additionalNames = new Map(
    (await getProcedureTypeNames(tenantId, [...new Set(additionalIds)])).map((t) => [t.id, t.name]),
  )

  return [...Map.groupBy(sessions, (s) => s.patientId).values()].map((group) => {
    const { patientId, patientName, patientPhone } = group[0]
    const sessionIds = group.map((s) => s.id)
    let claimedIds: string[] = []
    const procedureNames = new Set(
      group.flatMap((s) => [
        s.procedureTypeName,
        ...(s.additionalTypeIds ?? []).flatMap((id) => additionalNames.get(id) ?? []),
      ]),
    )
    return {
      ref: `sessions ${sessionIds.join(',')}`,
      patientId,
      patientName,
      phone: patientPhone,
      values: {
        patient_name: firstName(patientName),
        procedure_name: joinPt([...procedureNames]),
      },
      claim: async () => {
        claimedIds = await claimFollowUp(tenantId, sessionIds)
        return claimedIds.length > 0
      },
      release: () => releaseFollowUp(tenantId, claimedIds),
    }
  })
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

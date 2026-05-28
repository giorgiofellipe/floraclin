import { db } from '@/db/client'
import { appointments, patients, procedureTypes } from '@/db/schema'
import { eq, and, gte, lte, isNull, ne } from 'drizzle-orm'
import { subDays, addDays } from 'date-fns'
import { toBrYmd, parseBrDate } from '@/lib/dates'
import ical, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator'

const BR_TZ = 'America/Sao_Paulo'

export async function generateICalFeed(
  tenantId: string,
  userId: string | null,
  calendarName: string
): Promise<string> {
  const now = new Date()
  const dateFrom = toBrYmd(subDays(now, 7))
  const dateTo = toBrYmd(addDays(now, 60))

  const conditions = [
    eq(appointments.tenantId, tenantId),
    gte(appointments.date, dateFrom),
    lte(appointments.date, dateTo),
    isNull(appointments.deletedAt),
    ne(appointments.status, 'cancelled'),
    ne(appointments.status, 'no_show'),
  ]

  if (userId) {
    conditions.push(eq(appointments.practitionerId, userId))
  }

  const rows = await db
    .select({
      id: appointments.id,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      patientName: patients.fullName,
      procedureTypeName: procedureTypes.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(and(...conditions))
    .orderBy(appointments.date, appointments.startTime)

  const cal = ical({
    name: calendarName,
    prodId: { company: 'FloraClin', product: 'Agenda', language: 'PT' },
    method: ICalCalendarMethod.PUBLISH,
    timezone: BR_TZ,
  })

  for (const row of rows) {
    const summary =
      row.procedureTypeName && row.patientName
        ? `${row.procedureTypeName} - ${row.patientName}`
        : row.patientName ?? 'Agendamento'

    const icalStatus =
      row.status === 'scheduled'
        ? ICalEventStatus.TENTATIVE
        : ICalEventStatus.CONFIRMED

    cal.createEvent({
      id: `${row.id}@floraclin.com.br`,
      summary,
      description: 'Agendamento FloraClin',
      start: parseBrDate(row.date, `${row.startTime}:00`),
      end: parseBrDate(row.date, `${row.endTime}:00`),
      timezone: BR_TZ,
      status: icalStatus,
    })
  }

  return cal.toString()
}

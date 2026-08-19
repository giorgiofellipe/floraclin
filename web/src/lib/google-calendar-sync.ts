import { db } from '@/db/client'
import { appointments, patients, procedureTypes } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getGoogleCalendarClient, reportCalendarFailure } from '@/lib/google-calendar'
import { getConnectionByUserId, getClinicConnection } from '@/db/queries/calendar'

const BR_TZ = 'America/Sao_Paulo'

interface AppointmentForSync {
  id: string
  tenantId: string
  practitionerId: string
  date: string
  startTime: string
  endTime: string
  status: string
  googleEventId: string | null
  clinicGoogleEventId: string | null
  patientName: string | null
  procedureTypeName: string | null
  deletedAt: Date | null
}

async function loadAppointmentForSync(
  tenantId: string,
  appointmentId: string
): Promise<AppointmentForSync | null> {
  const [result] = await db
    .select({
      id: appointments.id,
      tenantId: appointments.tenantId,
      practitionerId: appointments.practitionerId,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      googleEventId: appointments.googleEventId,
      clinicGoogleEventId: appointments.clinicGoogleEventId,
      patientName: patients.fullName,
      procedureTypeName: procedureTypes.name,
      deletedAt: appointments.deletedAt,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId)
      )
    )
    .limit(1)

  return result ?? null
}

export function buildEventSummary(
  patientName: string | null,
  procedureTypeName: string | null
): string {
  if (procedureTypeName && patientName) {
    return `${procedureTypeName} - ${patientName}`
  }
  if (patientName) {
    return patientName
  }
  return 'Agendamento'
}

export function buildEventBody(appt: AppointmentForSync) {
  const summary = buildEventSummary(appt.patientName, appt.procedureTypeName)
  const isTentative = appt.status === 'scheduled'
  const googleStatus = isTentative ? 'tentative' : 'confirmed'

  return {
    summary,
    description: 'Agendamento FloraClin',
    start: {
      dateTime: `${appt.date}T${appt.startTime}`,
      timeZone: BR_TZ,
    },
    end: {
      dateTime: `${appt.date}T${appt.endTime}`,
      timeZone: BR_TZ,
    },
    status: googleStatus,
  }
}

export async function syncAppointmentToGoogle(
  tenantId: string,
  appointmentId: string
): Promise<void> {
  try {
    const appt = await loadAppointmentForSync(tenantId, appointmentId)
    if (!appt) return

    const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show' || appt.deletedAt !== null

    await syncToCalendar(appt, 'practitioner', isCancelled)
    await syncToCalendar(appt, 'clinic', isCancelled)
  } catch (error) {
    // Swallowed so a Google outage never costs the clinic the appointment it
    // just saved. Reported here rather than at the call sites, because this
    // catch is the last place the error exists: the promise callers hold
    // never rejects.
    reportCalendarFailure(error, 'push_appointment', { tenantId, appointmentId })
  }
}

async function syncToCalendar(
  appt: AppointmentForSync,
  target: 'practitioner' | 'clinic',
  isCancelled: boolean
) {
  try {
    const connection = target === 'practitioner'
      ? await getConnectionByUserId(appt.tenantId, appt.practitionerId)
      : await getClinicConnection(appt.tenantId)

    if (!connection || !connection.enabled) return

    const eventIdField = target === 'practitioner' ? 'googleEventId' : 'clinicGoogleEventId'
    const existingEventId = appt[eventIdField]

    const { calendar } = await getGoogleCalendarClient(connection.id)

    if (isCancelled && existingEventId) {
      try {
        await calendar.events.delete({
          calendarId: connection.calendarId,
          eventId: existingEventId,
        })
      } catch (err: unknown) {
        const status = (err as { code?: number })?.code
        if (status !== 404 && status !== 410) throw err
      }

      const updateData = target === 'practitioner'
        ? { googleEventId: null, updatedAt: new Date() }
        : { clinicGoogleEventId: null, updatedAt: new Date() }

      await db
        .update(appointments)
        .set(updateData)
        .where(eq(appointments.id, appt.id))

    } else if (!isCancelled && existingEventId) {
      const eventBody = buildEventBody(appt)
      await calendar.events.patch({
        calendarId: connection.calendarId,
        eventId: existingEventId,
        requestBody: eventBody,
      })

    } else if (!isCancelled && !existingEventId) {
      const eventBody = buildEventBody(appt)
      const response = await calendar.events.insert({
        calendarId: connection.calendarId,
        requestBody: eventBody,
      })

      const newEventId = response.data.id
      if (newEventId) {
        const updateData = target === 'practitioner'
          ? { googleEventId: newEventId, updatedAt: new Date() }
          : { clinicGoogleEventId: newEventId, updatedAt: new Date() }

        await db
          .update(appointments)
          .set(updateData)
          .where(eq(appointments.id, appt.id))
      }
    }
  } catch (error) {
    reportCalendarFailure(error, 'push_appointment', {
      tenantId: appt.tenantId,
      appointmentId: appt.id,
      target,
    })
  }
}

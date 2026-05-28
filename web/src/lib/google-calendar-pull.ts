import { getGoogleCalendarClient } from '@/lib/google-calendar'
import {
  upsertCalendarBlock,
  deleteCalendarBlock,
  updateConnection,
} from '@/db/queries/calendar'
import { db } from '@/db/client'
import { appointments } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { addDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { toBrYmd } from '@/lib/dates'
import type { calendar_v3 } from 'googleapis'

async function isOurOwnEvent(
  tenantId: string,
  googleEventId: string
): Promise<boolean> {
  const [match] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        sql`(${appointments.googleEventId} = ${googleEventId} OR ${appointments.clinicGoogleEventId} = ${googleEventId})`
      )
    )
    .limit(1)

  return !!match
}

export function shouldIncludeEvent(event: calendar_v3.Schema$Event): boolean {
  if (event.status === 'cancelled') return false
  if (event.transparency === 'transparent') return false

  const attendees = event.attendees ?? []
  const selfAttendee = attendees.find((a) => a.self)
  if (selfAttendee && selfAttendee.responseStatus === 'declined') return false

  return true
}

export function extractEventTiming(event: calendar_v3.Schema$Event): {
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
} | null {
  if (event.start?.date) {
    return {
      date: event.start.date,
      startTime: null,
      endTime: null,
      allDay: true,
    }
  }

  if (event.start?.dateTime && event.end?.dateTime) {
    const start = new Date(event.start.dateTime)
    const end = new Date(event.end.dateTime)

    const date = toBrYmd(start)
    const startTime = formatInTimeZone(start, 'America/Sao_Paulo', 'HH:mm')
    const endTime = formatInTimeZone(end, 'America/Sao_Paulo', 'HH:mm')

    return { date, startTime, endTime, allDay: false }
  }

  return null
}

async function processEvent(
  event: calendar_v3.Schema$Event,
  connectionId: string,
  tenantId: string,
  practitionerId: string
) {
  const googleEventId = event.id
  if (!googleEventId) return

  if (event.status === 'cancelled') {
    await deleteCalendarBlock(connectionId, googleEventId)
    return
  }

  if (!shouldIncludeEvent(event)) {
    await deleteCalendarBlock(connectionId, googleEventId)
    return
  }

  const isOurs = await isOurOwnEvent(tenantId, googleEventId)
  if (isOurs) return

  const timing = extractEventTiming(event)
  if (!timing) return

  await upsertCalendarBlock({
    tenantId,
    practitionerId,
    connectionId,
    googleEventId,
    title: event.summary ?? null,
    date: timing.date,
    startTime: timing.startTime,
    endTime: timing.endTime,
    allDay: timing.allDay,
    status: event.status === 'tentative' ? 'tentative' : 'confirmed',
  })
}

export async function runInitialSync(connectionId: string): Promise<void> {
  const { calendar, connection } = await getGoogleCalendarClient(connectionId)

  if (!connection.userId) return

  const now = new Date()
  const timeMin = now.toISOString()
  const timeMax = addDays(now, 30).toISOString()

  let pageToken: string | undefined
  let syncToken: string | undefined

  do {
    const response = await calendar.events.list({
      calendarId: connection.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 250,
      pageToken,
    })

    const events = response.data.items ?? []
    for (const event of events) {
      await processEvent(
        event,
        connectionId,
        connection.tenantId,
        connection.userId
      )
    }

    pageToken = response.data.nextPageToken ?? undefined
    syncToken = response.data.nextSyncToken ?? undefined
  } while (pageToken)

  if (syncToken) {
    await updateConnection(connectionId, connection.tenantId, {
      syncToken,
    })
  }
}

export async function incrementalSync(connectionId: string): Promise<void> {
  const { calendar, connection } = await getGoogleCalendarClient(connectionId)

  if (!connection.userId) return

  let syncToken = connection.syncToken
  if (!syncToken) {
    await runInitialSync(connectionId)
    return
  }

  let pageToken: string | undefined
  let newSyncToken: string | undefined

  try {
    do {
      const response = await calendar.events.list({
        calendarId: connection.calendarId,
        syncToken,
        pageToken,
      })

      const events = response.data.items ?? []
      for (const event of events) {
        await processEvent(
          event,
          connectionId,
          connection.tenantId,
          connection.userId
        )
      }

      pageToken = response.data.nextPageToken ?? undefined
      newSyncToken = response.data.nextSyncToken ?? undefined
    } while (pageToken)

    if (newSyncToken) {
      await updateConnection(connectionId, connection.tenantId, {
        syncToken: newSyncToken,
      })
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 410) {
      await updateConnection(connectionId, connection.tenantId, {
        syncToken: null,
      })
      await runInitialSync(connectionId)
    } else {
      throw err
    }
  }
}

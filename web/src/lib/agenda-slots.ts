import { blockInterval, firstFreeSlot, freeGaps, minutesToTime, openingWindow, timeToMinutes, type Interval, type WorkingHours } from '@/lib/free-slots'
import { shiftBrYmd } from '@/lib/dates'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'

const BOOKING_MIN = 30
// The server's conflict check lets these be booked over.
const FREE_STATUSES = new Set(['cancelled', 'no_show', 'pending_reschedule'])

/** "Now" on the browser clock, which is the clinic's clock: a BR calendar day and minutes into it. */
export interface AgendaNow {
  ymd: string
  minutes: number
}

/** What keeps `practitionerId` busy on `date`: their live appointments and their or the clinic's blocks. */
function busyIntervals(date: string, practitionerId: string, appointments: AppointmentWithDetails[], blocks: CalendarBlockRow[]): Interval[] {
  return [
    ...appointments
      .filter((a) => a.date === date && a.practitionerId === practitionerId && !FREE_STATUSES.has(a.status))
      .map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) })),
    ...blocks.filter((b) => b.date === date && (b.practitionerId === null || b.practitionerId === practitionerId)).map(blockInterval),
  ]
}

/**
 * The first 30-minute opening for `practitionerId` from `fromDate` to `toDate`
 * (the days the agenda has loaded): from now on today, from opening time on
 * later days. Null when those days are full; the caller then asks the server.
 */
export function nextFreeSlot({
  practitionerId,
  fromDate,
  toDate,
  now,
  appointments,
  blocks,
  workingHours,
}: {
  practitionerId: string
  fromDate: string
  toDate: string
  now: AgendaNow
  appointments: AppointmentWithDetails[]
  blocks: CalendarBlockRow[]
  workingHours: WorkingHours | null | undefined
}): { date: string; startTime: string } | null {
  const firstIn = (date: string, busy: Interval[]) => {
    const opening = openingWindow(date, workingHours)
    if (!opening) return null
    const start = firstFreeSlot(freeGaps(opening, busy), date === now.ymd ? now.minutes : opening.start, BOOKING_MIN)
    return start === null ? null : { date, startTime: minutesToTime(start) }
  }

  for (let date = fromDate < now.ymd ? now.ymd : fromDate; date <= toDate; date = shiftBrYmd(date, 1)) {
    const slot = firstIn(date, busyIntervals(date, practitionerId, appointments, blocks))
    if (slot) return slot
  }
  return null
}

export type DayAgendaRow =
  | { kind: 'appointment'; at: number; appointment: AppointmentWithDetails }
  | { kind: 'block'; at: number; block: CalendarBlockRow }
  | { kind: 'gap'; at: number; gap: Interval }

const ROW_ORDER: Record<DayAgendaRow['kind'], number> = { block: 0, appointment: 1, gap: 2 }

/**
 * One day's blocks and appointments plus the gaps `practitionerId` could still
 * be booked into, in time order. Gaps shorter than a booking or already past
 * are left out.
 */
export function dayAgendaRows({
  date,
  practitionerId,
  appointments,
  blocks,
  workingHours,
  now,
}: {
  date: string
  practitionerId: string
  appointments: AppointmentWithDetails[]
  blocks: CalendarBlockRow[]
  workingHours: WorkingHours | null | undefined
  now: AgendaNow
}): DayAgendaRow[] {
  const rows: DayAgendaRow[] = [
    ...blocks.filter((block) => block.date === date).map((block) => ({ kind: 'block' as const, at: blockInterval(block).start, block })),
    ...appointments.map((appointment) => ({ kind: 'appointment' as const, at: timeToMinutes(appointment.startTime), appointment })),
  ]
  const opening = openingWindow(date, workingHours)
  if (opening && date >= now.ymd) {
    const from = date === now.ymd ? Math.max(opening.start, Math.ceil(now.minutes / BOOKING_MIN) * BOOKING_MIN) : opening.start
    if (from < opening.end) {
      for (const gap of freeGaps({ start: from, end: opening.end }, busyIntervals(date, practitionerId, appointments, blocks))) {
        if (gap.end - gap.start >= BOOKING_MIN) rows.push({ kind: 'gap', at: gap.start, gap })
      }
    }
  }
  return rows.sort((a, b) => a.at - b.at || ROW_ORDER[a.kind] - ROW_ORDER[b.kind])
}

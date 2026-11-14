import { getAvailableSlots, getAvailableSlotsByDay, type TimeSlot } from '@/db/queries/appointments'
import { brToday, parseBrDate, shiftBrYmd } from '@/lib/dates'

const ONLINE_BOOKING_SLOT_MIN = 30

function future(date: string, slots: TimeSlot[]): TimeSlot[] {
  const now = Date.now()
  return slots.filter((slot) => parseBrDate(date, `${slot.start}:00`).getTime() > now)
}

/** The times the public booking page offers, and the only ones its POST accepts. */
export async function getBookableSlots(tenantId: string, practitionerId: string, date: string): Promise<TimeSlot[]> {
  return future(date, await getAvailableSlots(tenantId, practitionerId, date, ONLINE_BOOKING_SLOT_MIN))
}

const RESCHEDULE_SEARCH_DAYS = 14

/**
 * The next free slots an appointment can move to, from today on. Its own time
 * does not block its neighbours, and is not offered itself. At most `perDay`
 * per day, so the choice spans several days.
 */
export async function nextRescheduleSlots(
  tenantId: string,
  appointment: { id: string; practitionerId: string; durationMin: number; date: string; startTime: string },
  { limit, perDay }: { limit: number; perDay: number },
): Promise<{ date: string; start: string; end: string }[]> {
  const today = brToday()
  const byDay = await getAvailableSlotsByDay(
    tenantId,
    appointment.practitionerId,
    today,
    shiftBrYmd(today, RESCHEDULE_SEARCH_DAYS - 1),
    appointment.durationMin,
    appointment.id,
  )
  return [...byDay.entries()]
    .flatMap(([date, slots]) =>
      future(date, slots)
        .filter((slot) => !(date === appointment.date && slot.start === appointment.startTime.slice(0, 5)))
        .slice(0, perDay)
        .map((slot) => ({ date, ...slot })),
    )
    .slice(0, limit)
}

const NEXT_SLOT_SEARCH_DAYS = 14

/** The first future 30-minute slot for `practitionerId` from `fromDate` on, or null within two weeks. */
export async function nextBookableSlot(tenantId: string, practitionerId: string, fromDate: string): Promise<{ date: string; startTime: string } | null> {
  const start = fromDate < brToday() ? brToday() : fromDate
  const byDay = await getAvailableSlotsByDay(tenantId, practitionerId, start, shiftBrYmd(start, NEXT_SLOT_SEARCH_DAYS - 1), ONLINE_BOOKING_SLOT_MIN)
  for (const [date, slots] of byDay) {
    const [first] = future(date, slots)
    if (first) return { date, startTime: first.start }
  }
  return null
}

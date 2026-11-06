import { getAvailableSlots, type TimeSlot } from '@/db/queries/appointments'
import { parseBrDate } from '@/lib/dates'

const ONLINE_BOOKING_SLOT_MIN = 30

/** The times the public booking page offers, and the only ones its POST accepts. */
export async function getBookableSlots(tenantId: string, practitionerId: string, date: string): Promise<TimeSlot[]> {
  const slots = await getAvailableSlots(tenantId, practitionerId, date, ONLINE_BOOKING_SLOT_MIN)
  const now = Date.now()
  return slots.filter((slot) => parseBrDate(date, `${slot.start}:00`).getTime() > now)
}

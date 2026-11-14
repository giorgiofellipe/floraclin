import { describe, expect, it } from 'vitest'
import { nextFreeSlot } from '../agenda-slots'
import type { AppointmentWithDetails } from '@/db/queries/appointments'
import type { CalendarBlockRow } from '@/db/queries/calendar'

const HOURS = {
  mon: { enabled: true, start: '08:00', end: '18:00' },
  tue: { enabled: true, start: '08:00', end: '18:00' },
  sat: { enabled: false, start: '08:00', end: '12:00' },
  sun: { enabled: false, start: '08:00', end: '12:00' },
}

function appt(date: string, startTime: string, endTime: string, practitionerId = 'p1', status = 'scheduled') {
  return { id: `${date}-${startTime}-${practitionerId}`, date, startTime, endTime, practitionerId, status } as AppointmentWithDetails
}

function block(date: string, startTime: string | null, endTime: string | null, practitionerId: string | null = null) {
  return { id: 'b', date, startTime, endTime, practitionerId, allDay: startTime === null } as CalendarBlockRow
}

const base = { practitionerId: 'p1', workingHours: HOURS, blocks: [] as CalendarBlockRow[] }

describe('nextFreeSlot', () => {
  // Regression: "+ Agendar" always opened at 08:00, on top of whatever was booked there.
  it('starts after now and after the bookings of the practitioner who will be booked', () => {
    const slot = nextFreeSlot({
      ...base,
      fromDate: '2026-11-16',
      toDate: '2026-11-16',
      now: { ymd: '2026-11-16', minutes: 10 * 60 + 10 },
      appointments: [appt('2026-11-16', '10:30', '11:00'), appt('2026-11-16', '11:00', '11:30', 'p2')],
    })
    expect(slot).toEqual({ date: '2026-11-16', startTime: '11:00' })
  })

  it('books over cancelled, missed and reschedule-pending appointments, like the server', () => {
    const slot = nextFreeSlot({
      ...base,
      fromDate: '2026-11-16',
      toDate: '2026-11-16',
      now: { ymd: '2026-11-15', minutes: 0 },
      appointments: [
        appt('2026-11-16', '08:00', '08:30', 'p1', 'cancelled'),
        appt('2026-11-16', '08:00', '08:30', 'p1', 'no_show'),
        appt('2026-11-16', '08:00', '08:30', 'p1', 'pending_reschedule'),
      ],
    })
    expect(slot).toEqual({ date: '2026-11-16', startTime: '08:00' })
  })

  it('treats a clinic-wide block as busy for every practitioner', () => {
    const slot = nextFreeSlot({
      ...base,
      fromDate: '2026-11-16',
      toDate: '2026-11-17',
      now: { ymd: '2026-11-15', minutes: 0 },
      appointments: [],
      blocks: [block('2026-11-16', null, null), block('2026-11-17', '08:00:00', '09:00:00')],
    })
    expect(slot).toEqual({ date: '2026-11-17', startTime: '09:00' })
  })

  it('returns nothing when the loaded days have no opening, so the server is asked', () => {
    // A Saturday day view: the clinic is closed and nothing else is loaded.
    const slot = nextFreeSlot({ ...base, fromDate: '2026-11-14', toDate: '2026-11-14', now: { ymd: '2026-11-14', minutes: 600 }, appointments: [] })
    expect(slot).toBeNull()
  })
})

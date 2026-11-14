import { describe, expect, it } from 'vitest'
import { dayAgendaRows, nextFreeSlot } from '../agenda-slots'
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

describe('dayAgendaRows', () => {
  const day = (overrides: Partial<Parameters<typeof dayAgendaRows>[0]>) =>
    dayAgendaRows({ date: '2026-11-16', practitionerId: 'p1', appointments: [], blocks: [], workingHours: HOURS, now: { ymd: '2026-11-16', minutes: 0 }, ...overrides })
      .map((r) => (r.kind === 'gap' ? `livre ${r.gap.start}-${r.gap.end}` : r.kind === 'block' ? `bloqueio ${r.at}` : `appt ${r.appointment.startTime}`))

  it('lists blocks, appointments and the bookable gaps between them, without gaps already past', () => {
    const rows = day({
      appointments: [appt('2026-11-16', '09:00', '09:45'), appt('2026-11-16', '10:30', '11:00')],
      blocks: [block('2026-11-16', '11:30:00', '18:00:00')],
      now: { ymd: '2026-11-16', minutes: 8 * 60 + 40 },
    })
    // At 08:40 the next bookable half hour is 09:00, already taken.
    expect(rows).toEqual(['appt 09:00', 'livre 585-630', 'appt 10:30', 'livre 660-690', 'bloqueio 690'])
  })

  it('shows the gaps of the practitioner a gap row books, not the time other practitioners are busy', () => {
    // Regression: with "Todos" selected, a second practitioner's day hid the gaps of the one being booked.
    const rows = day({ appointments: [appt('2026-11-16', '08:00', '18:00', 'p2')] })
    expect(rows).toEqual(['appt 08:00', 'livre 480-1080'])
  })

  it('offers no gaps on a closed day or a past day', () => {
    expect(day({ date: '2026-11-15' })).toEqual([])
    expect(day({ appointments: [appt('2026-11-16', '09:00', '09:30')], now: { ymd: '2026-11-17', minutes: 0 } })).toEqual(['appt 09:00'])
  })
})

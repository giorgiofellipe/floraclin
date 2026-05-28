import { describe, it, expect, vi } from 'vitest'
import type { calendar_v3 } from 'googleapis'

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    calendar: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getGoogleCalendarClient: vi.fn(),
}))

vi.mock('@/db/queries/calendar', () => ({
  upsertCalendarBlock: vi.fn(),
  deleteCalendarBlock: vi.fn(),
  updateConnection: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  appointments: {
    id: 'id',
    tenantId: 'tenant_id',
    googleEventId: 'google_event_id',
    clinicGoogleEventId: 'clinic_google_event_id',
  },
}))

vi.mock('@/lib/dates', () => ({
  toBrYmd: vi.fn((date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }),
}))

import { shouldIncludeEvent, extractEventTiming } from '../google-calendar-pull'

describe('shouldIncludeEvent', () => {
  it('should exclude cancelled events', () => {
    expect(
      shouldIncludeEvent({ status: 'cancelled' } as calendar_v3.Schema$Event)
    ).toBe(false)
  })

  it('should exclude transparent events', () => {
    expect(
      shouldIncludeEvent({
        status: 'confirmed',
        transparency: 'transparent',
      } as calendar_v3.Schema$Event)
    ).toBe(false)
  })

  it('should exclude declined events', () => {
    const event = {
      status: 'confirmed',
      attendees: [{ self: true, responseStatus: 'declined' }],
    } as calendar_v3.Schema$Event
    expect(shouldIncludeEvent(event)).toBe(false)
  })

  it('should include confirmed opaque events', () => {
    expect(
      shouldIncludeEvent({ status: 'confirmed' } as calendar_v3.Schema$Event)
    ).toBe(true)
  })

  it('should include tentative events', () => {
    expect(
      shouldIncludeEvent({ status: 'tentative' } as calendar_v3.Schema$Event)
    ).toBe(true)
  })
})

describe('extractEventTiming', () => {
  it('should handle all-day events', () => {
    const result = extractEventTiming({
      start: { date: '2026-06-01' },
      end: { date: '2026-06-02' },
    } as calendar_v3.Schema$Event)

    expect(result).toEqual({
      date: '2026-06-01',
      startTime: null,
      endTime: null,
      allDay: true,
    })
  })

  it('should handle timed events', () => {
    const result = extractEventTiming({
      start: { dateTime: '2026-06-01T14:00:00-03:00' },
      end: { dateTime: '2026-06-01T15:00:00-03:00' },
    } as calendar_v3.Schema$Event)

    expect(result).not.toBeNull()
    expect(result!.allDay).toBe(false)
    expect(result!.startTime).toBeDefined()
    expect(result!.endTime).toBeDefined()
  })

  it('should return null for events with no start/end', () => {
    expect(extractEventTiming({} as calendar_v3.Schema$Event)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { createCalendarBlockSchema } from '../calendar-block'
import { halfHourTimes, timeItems, START_TIMES, END_TIMES } from '@/lib/time-options'

describe('createCalendarBlockSchema', () => {
  const base = { practitionerId: '11111111-1111-4111-8111-111111111111', date: '2026-10-12' }
  const timed = { ...base, allDay: false, startTime: '12:00', endTime: '13:00' }

  it('accepts a timed block', () => {
    expect(createCalendarBlockSchema.safeParse(timed).success).toBe(true)
  })

  it('accepts an all-day clinic-wide block', () => {
    const result = createCalendarBlockSchema.safeParse({ ...base, practitionerId: null, allDay: true })
    expect(result.success).toBe(true)
  })

  it('rejects a timed block without both times', () => {
    expect(createCalendarBlockSchema.safeParse({ ...base, allDay: false }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...base, allDay: false, startTime: '12:00' }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...base, allDay: false, endTime: '13:00' }).success).toBe(false)
  })

  it('rejects end before or equal to start', () => {
    expect(createCalendarBlockSchema.safeParse({ ...timed, startTime: '13:00', endTime: '13:00' }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...timed, startTime: '13:00', endTime: '12:00' }).success).toBe(false)
  })

  it('rejects a malformed time', () => {
    expect(createCalendarBlockSchema.safeParse({ ...timed, startTime: '9:00' }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...timed, endTime: '25:00' }).success).toBe(false)
  })

  it('rejects a date that does not exist', () => {
    expect(createCalendarBlockSchema.safeParse({ ...timed, date: '2026-02-30' }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...timed, date: '2026-13-01' }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...timed, date: '2028-02-29' }).success).toBe(true)
  })

  it('trims the title and rejects more than 120 chars', () => {
    const trimmed = createCalendarBlockSchema.safeParse({ ...timed, title: '  Almoço  ' })
    expect(trimmed.success && trimmed.data.title).toBe('Almoço')
    expect(createCalendarBlockSchema.safeParse({ ...timed, title: 'a'.repeat(121) }).success).toBe(false)
    expect(createCalendarBlockSchema.safeParse({ ...timed, title: 'a'.repeat(120) }).success).toBe(true)
  })
})

describe('time options', () => {
  it('builds the shared 07:00 to 21:00 grid, start list without the last slot and end list without the first', () => {
    expect(halfHourTimes(20, 21)).toEqual(['20:00', '20:30', '21:00'])
    expect([START_TIMES[0], START_TIMES.at(-1)]).toEqual(['07:00', '20:30'])
    expect([END_TIMES[0], END_TIMES.at(-1)]).toEqual(['07:30', '21:00'])
  })
})

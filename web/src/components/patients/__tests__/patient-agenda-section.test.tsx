import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isUpcomingAppointment } from '../patient-agenda-section'

// BR is UTC-3: this instant is 2026-11-01 23:00 in Sao Paulo but already 2026-11-02 in UTC.
const NOW = new Date('2026-11-02T02:00:00Z')

describe('isUpcomingAppointment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['2026-10-31', '10:00', false],
    ['2026-11-01', '20:00', false],
    ['2026-11-01', '23:30', true],
    ['2026-11-02', '09:00', true],
  ])('%s %s upcoming=%s on a UTC host', (date, startTime, expected) => {
    expect(isUpcomingAppointment({ date, startTime })).toBe(expected)
  })
})

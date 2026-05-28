import { describe, it, expect } from 'vitest'
import {
  birthdayMonthDayPairs,
  todayMonthDay,
  currentBrYear,
  yearFromYmd,
} from '../birthdays'
import { brToday } from '../dates'

describe('birthdayMonthDayPairs', () => {
  it('returns single pair for one-day range', () => {
    expect(birthdayMonthDayPairs({ from: '2026-05-27', to: '2026-05-27' })).toEqual([
      { month: 5, day: 27 },
    ])
  })

  it('returns inclusive range across days', () => {
    const pairs = birthdayMonthDayPairs({ from: '2026-05-27', to: '2026-05-29' })
    expect(pairs).toContainEqual({ month: 5, day: 27 })
    expect(pairs).toContainEqual({ month: 5, day: 28 })
    expect(pairs).toContainEqual({ month: 5, day: 29 })
    expect(pairs).toHaveLength(3)
  })

  it('crosses month boundary', () => {
    const pairs = birthdayMonthDayPairs({ from: '2026-01-31', to: '2026-02-02' })
    expect(pairs).toContainEqual({ month: 1, day: 31 })
    expect(pairs).toContainEqual({ month: 2, day: 1 })
    expect(pairs).toContainEqual({ month: 2, day: 2 })
  })

  it('includes Feb 29 when range covers Feb 28 in a non-leap year (derived from FROM)', () => {
    // 2027 is not a leap year — the helper now derives leap context from the
    // FROM year, not from today, so this is independent of host clock.
    const pairs = birthdayMonthDayPairs({ from: '2027-02-27', to: '2027-02-28' })
    expect(pairs).toContainEqual({ month: 2, day: 28 })
    expect(pairs).toContainEqual({ month: 2, day: 29 })
  })

  it('does NOT append Feb 29 when the FROM year IS a leap year', () => {
    // 2028 is a leap year. Range covers Feb 28 only; Feb 29 should not be
    // appended because the year naturally contains the date already.
    const pairs = birthdayMonthDayPairs({ from: '2028-02-27', to: '2028-02-28' })
    expect(pairs).toContainEqual({ month: 2, day: 28 })
    expect(pairs).not.toContainEqual({ month: 2, day: 29 })
  })

  it('does not double-add Feb 29 when range already includes it (leap-year input)', () => {
    // Even on a non-leap current year, if the input already has Feb 29 we should
    // not append a duplicate.
    const pairs = birthdayMonthDayPairs({ from: '2028-02-27', to: '2028-02-29' })
    const feb29Count = pairs.filter((p) => p.month === 2 && p.day === 29).length
    expect(feb29Count).toBe(1)
  })

  it('handles empty / inverted range gracefully', () => {
    // `to` before `from` yields an empty list (cursor starts past end).
    const pairs = birthdayMonthDayPairs({ from: '2026-05-29', to: '2026-05-27' })
    expect(pairs).toEqual([])
  })

  it('rejects invalid YMD inputs', () => {
    expect(() => birthdayMonthDayPairs({ from: 'not-a-date', to: '2026-05-27' })).toThrow()
  })
})

describe('todayMonthDay', () => {
  it('returns BR-local month/day matching brToday()', () => {
    const today = brToday()
    const expected = {
      month: parseInt(today.slice(5, 7), 10),
      day: parseInt(today.slice(8, 10), 10),
    }
    expect(todayMonthDay()).toEqual(expected)
  })
})

describe('currentBrYear', () => {
  it('returns the year portion of brToday()', () => {
    const today = brToday()
    expect(currentBrYear()).toBe(parseInt(today.slice(0, 4), 10))
  })
})

describe('yearFromYmd', () => {
  it('extracts the year for a current-year date', () => {
    expect(yearFromYmd('2026-05-27')).toBe(2026)
  })

  it('extracts the year for a future-window date', () => {
    expect(yearFromYmd('2030-01-15')).toBe(2030)
  })

  it('extracts the year for a past-window date', () => {
    expect(yearFromYmd('2024-12-31')).toBe(2024)
  })

  it('throws on a malformed input', () => {
    expect(() => yearFromYmd('not-a-date')).toThrow()
    expect(() => yearFromYmd('26-05-27')).toThrow()
  })
})

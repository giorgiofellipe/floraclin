import { describe, it, expect } from 'vitest'
import { birthdayMonthDayPairs, todayMonthDay, currentBrYear } from '../birthdays'
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

  it('includes Feb 29 when range covers Feb 28 in a non-leap year', () => {
    // 2026 is not a leap year — current year used by the helper comes from brToday(),
    // which is 2026 in this test context.
    const pairs = birthdayMonthDayPairs({ from: '2027-02-27', to: '2027-02-28' })
    expect(pairs).toContainEqual({ month: 2, day: 28 })
    expect(pairs).toContainEqual({ month: 2, day: 29 })
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

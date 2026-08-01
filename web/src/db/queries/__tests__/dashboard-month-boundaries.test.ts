import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveMonthBoundaries } from '../dashboard'

describe('resolveMonthBoundaries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to the current BR month when omitted (previous getQuickStats default behaviour)', () => {
    // Comfortably inside BR business hours, no day-boundary ambiguity.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))

    const result = resolveMonthBoundaries()

    expect(result.isCurrentMonth).toBe(true)
    expect(result.monthStartYmd).toBe('2026-04-01')
    expect(result.monthEndYmd).toBe('2026-04-30')
  })

  it('resolves an explicit past month and marks it as not the current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))

    const result = resolveMonthBoundaries('2026-02')

    expect(result.isCurrentMonth).toBe(false)
    expect(result.monthStartYmd).toBe('2026-02-01')
    expect(result.monthEndYmd).toBe('2026-02-28')
  })

  it('treats the current month passed explicitly the same as omitting it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))

    expect(resolveMonthBoundaries('2026-04').isCurrentMonth).toBe(true)
  })

  it('gets the last day of a 31-day month right', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'))
    expect(resolveMonthBoundaries('2026-01').monthEndYmd).toBe('2026-01-31')
  })

  it('gets the last day of a 30-day month right', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'))
    expect(resolveMonthBoundaries('2026-04').monthEndYmd).toBe('2026-04-30')
  })

  it('gets the last day of February right on a leap year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2028-06-01T10:00:00.000Z'))
    expect(resolveMonthBoundaries('2028-02').monthEndYmd).toBe('2028-02-29')
  })

  it('gets the last day of February right on a non-leap year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'))
    expect(resolveMonthBoundaries('2026-02').monthEndYmd).toBe('2026-02-28')
  })

  it('always starts the month on the 1st', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'))
    expect(resolveMonthBoundaries('2026-03').monthStartYmd).toBe('2026-03-01')
  })

  it('resolves the current month via the BR calendar day, not the host UTC day', () => {
    // 2026-04-01T02:00:00Z is 2026-03-31T23:00:00-03:00 in BR: UTC has
    // already rolled into April, but the BR calendar is still March 31.
    // A bare `new Date()` + local getters would incorrectly resolve to
    // April here on a UTC host; brToday() must not.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T02:00:00.000Z'))

    const result = resolveMonthBoundaries()

    expect(result.monthStartYmd).toBe('2026-03-01')
    expect(result.monthEndYmd).toBe('2026-03-31')
  })

  it('rejects a month in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    expect(() => resolveMonthBoundaries('2026-05')).toThrow(/future/)
  })

  it('does not reject the current month itself as "future"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    expect(() => resolveMonthBoundaries('2026-04')).not.toThrow()
  })

  it('rejects malformed month strings', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    for (const bad of [
      '2026-13',
      '2026-00',
      '26-04',
      '2026/04',
      '2026-4',
      'not-a-month',
      '2026-04-01',
      '',
    ]) {
      expect(() => resolveMonthBoundaries(bad)).toThrow()
    }
  })
})

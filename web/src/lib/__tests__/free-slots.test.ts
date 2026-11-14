import { describe, expect, it } from 'vitest'
import { firstFreeSlot, freeGaps, openingWindow } from '../free-slots'

describe('openingWindow', () => {
  it('reads the weekday of the BR calendar day, not the host timezone', () => {
    // 2026-11-16 is a Monday. A bare UTC parse would land on Sunday on hosts west of UTC.
    const hours = { mon: { enabled: true, start: '09:00', end: '17:30' }, sun: { enabled: false, start: '08:00', end: '12:00' } }
    expect(openingWindow('2026-11-16', hours)).toEqual({ start: 540, end: 1050 })
    expect(openingWindow('2026-11-15', hours)).toBeNull()
  })
})

describe('freeGaps and firstFreeSlot', () => {
  it('finds the gaps between busy intervals, merging overlaps', () => {
    const gaps = freeGaps({ start: 480, end: 720 }, [
      { start: 540, end: 600 },
      { start: 570, end: 630 },
      { start: 690, end: 760 },
    ])
    expect(gaps).toEqual([{ start: 480, end: 540 }, { start: 630, end: 690 }])
  })

  it('starts the first slot on the next half hour after `from`, skipping gaps too short for it', () => {
    const gaps = [{ start: 480, end: 520 }, { start: 600, end: 720 }]
    // 08:10 rounds to 08:30, but 08:30-09:00 runs past the 08:40 end of the first gap.
    expect(firstFreeSlot(gaps, 490, 30)).toBe(600)
    expect(firstFreeSlot(gaps, 615, 30)).toBe(630)
    expect(firstFreeSlot(gaps, 700, 30)).toBeNull()
  })
})

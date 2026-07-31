import { describe, expect, it } from 'vitest'
import { buildForwardSlots, buildTodaySlots, type PlannedAppointment } from '../schedule'
import { CATALOGUE, FORWARD_DAYS, MAX_PER_DAY, MIN_PER_DAY, TODAY_APPOINTMENTS } from '../config'
import { parseBrDate, toBrYmd } from '@/lib/dates'

const DURATION_OF: Record<string, number> = Object.fromEntries(CATALOGUE.map((item) => [item.name, item.durationMin]))

const TODAY_WORKING_START = 9 * 60 // 09:00
const TODAY_WORKING_END = 17 * 60 // 17:00
const FORWARD_WORKING_START = 8 * 60 // 08:00
const FORWARD_WORKING_END = 19 * 60 // 19:00, generous upper bound on start time

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function weekdayOf(ymdDate: string): number {
  return parseBrDate(ymdDate, '12:00:00').getDay()
}

// ─── Local pure calendar helpers -- independent of schedule.ts, so the
// expected forward window isn't computed by the code under test. ────────

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function ymdParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}
function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = month - 1 + delta
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedMonth = ((zeroBased % 12) + 12) % 12 + 1
  return { year: shiftedYear, month: shiftedMonth }
}
function addDaysYmd(day: string, delta: number): string {
  let { year, month, day: d } = ymdParts(day)
  d += delta
  while (d > daysInMonth(year, month)) {
    d -= daysInMonth(year, month)
    ;({ year, month } = shiftMonth(year, month, 1))
  }
  while (d < 1) {
    ;({ year, month } = shiftMonth(year, month, -1))
    d += daysInMonth(year, month)
  }
  return ymd(year, month, d)
}

function expectedOpenDays(todayYmd: string): string[] {
  const days: string[] = []
  for (let offset = 1; offset <= FORWARD_DAYS; offset++) {
    const day = addDaysYmd(todayYmd, offset)
    if (weekdayOf(day) !== 0) days.push(day)
  }
  return days
}

function byDate(slots: PlannedAppointment[]): Map<string, PlannedAppointment[]> {
  const map = new Map<string, PlannedAppointment[]>()
  for (const slot of slots) {
    map.set(slot.date, [...(map.get(slot.date) ?? []), slot])
  }
  return map
}

describe('buildTodaySlots', () => {
  const TODAY = parseBrDate('2026-07-27', '12:00:00')
  const slots = buildTodaySlots(TODAY)

  it('produces exactly TODAY_APPOINTMENTS slots', () => {
    expect(slots).toHaveLength(TODAY_APPOINTMENTS)
  })

  it('splits status 3 confirmed / 1 scheduled', () => {
    expect(slots.filter((s) => s.status === 'confirmed')).toHaveLength(3)
    expect(slots.filter((s) => s.status === 'scheduled')).toHaveLength(1)
  })

  it('is dated today, with start times inside 09:00-17:00', () => {
    const todayYmd = toBrYmd(TODAY)
    for (const slot of slots) {
      expect(slot.date).toBe(todayYmd)
      expect(toMinutes(slot.startTime)).toBeGreaterThanOrEqual(TODAY_WORKING_START)
      expect(toMinutes(slot.startTime)).toBeLessThan(TODAY_WORKING_END)
    }
  })

  it('endTime always derives from the procedure duration and exceeds startTime', () => {
    for (const slot of slots) {
      expect(slot.durationMin).toBe(DURATION_OF[slot.procedureName])
      expect(toMinutes(slot.endTime)).toBe(toMinutes(slot.startTime) + slot.durationMin)
      expect(toMinutes(slot.endTime)).toBeGreaterThan(toMinutes(slot.startTime))
    }
  })

  it('mixes more than one procedure', () => {
    expect(new Set(slots.map((s) => s.procedureName)).size).toBeGreaterThan(1)
  })

  it('never overlaps for the single practitioner', () => {
    const sorted = [...slots].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
    for (let i = 1; i < sorted.length; i++) {
      expect(toMinutes(sorted[i].startTime)).toBeGreaterThanOrEqual(toMinutes(sorted[i - 1].endTime))
    }
  })

  it('does not sit on a uniform grid', () => {
    const starts = [...slots].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)).map((s) => toMinutes(s.startTime))
    const gaps = new Set<number>()
    for (let i = 1; i < starts.length; i++) gaps.add(starts[i] - starts[i - 1])
    expect(gaps.size).toBeGreaterThan(1)
  })

  it('is deterministic for the same input', () => {
    expect(buildTodaySlots(TODAY)).toEqual(slots)
  })
})

describe('buildForwardSlots', () => {
  function checkInvariants(today: Date): PlannedAppointment[] {
    const slots = buildForwardSlots(today)
    const todayYmd = toBrYmd(today)
    const openDays = expectedOpenDays(todayYmd)

    // No Sunday appears anywhere in the window.
    for (const slot of slots) {
      expect(weekdayOf(slot.date)).not.toBe(0)
    }

    const grouped = byDate(slots)

    // Exactly the expected set of Monday-Saturday days appears -- every
    // open day got slots, no closed day did.
    expect([...grouped.keys()].sort()).toEqual([...openDays].sort())

    // Every open day has between MIN_PER_DAY and MAX_PER_DAY slots.
    for (const day of openDays) {
      const daySlots = grouped.get(day)
      expect(daySlots).toBeDefined()
      expect(daySlots!.length).toBeGreaterThanOrEqual(MIN_PER_DAY)
      expect(daySlots!.length).toBeLessThanOrEqual(MAX_PER_DAY)
    }

    // Start times inside working hours, endTime always after startTime,
    // and no overlap for the single practitioner within one day.
    for (const daySlots of grouped.values()) {
      const sorted = [...daySlots].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
      for (const slot of sorted) {
        expect(slot.durationMin).toBe(DURATION_OF[slot.procedureName])
        expect(toMinutes(slot.startTime)).toBeGreaterThanOrEqual(FORWARD_WORKING_START)
        expect(toMinutes(slot.startTime)).toBeLessThan(FORWARD_WORKING_END)
        expect(toMinutes(slot.endTime)).toBe(toMinutes(slot.startTime) + slot.durationMin)
        expect(toMinutes(slot.endTime)).toBeGreaterThan(toMinutes(slot.startTime))
      }
      for (let i = 1; i < sorted.length; i++) {
        expect(toMinutes(sorted[i].startTime)).toBeGreaterThanOrEqual(toMinutes(sorted[i - 1].endTime))
      }
    }

    // Exactly two encaixes, flagged through notes.
    const encaixes = slots.filter((s) => /encaixe/i.test(s.notes ?? ''))
    expect(encaixes).toHaveLength(2)
    // Both fall within the first two open days -- the soonest ones.
    for (const encaixe of encaixes) {
      expect(openDays.slice(0, 2)).toContain(encaixe.date)
    }

    // Some (but not all) slots read as returns.
    const returns = slots.filter((s) => /retorno/i.test(s.notes ?? ''))
    expect(returns.length).toBeGreaterThan(0)
    expect(returns.length).toBeLessThan(slots.length)

    return slots
  }

  it('holds for a normal mid-month today', () => {
    checkInvariants(parseBrDate('2026-07-27', '12:00:00'))
  })

  it('holds when today is the 1st of the month', () => {
    checkInvariants(parseBrDate('2026-08-01', '12:00:00'))
  })

  it('holds when today is the 28th of the month', () => {
    checkInvariants(parseBrDate('2026-02-28', '12:00:00'))
  })

  it('holds when today is the 31st of the month', () => {
    checkInvariants(parseBrDate('2026-07-31', '12:00:00'))
  })

  it('is deterministic for the same input', () => {
    const today = parseBrDate('2026-07-27', '12:00:00')
    expect(buildForwardSlots(today)).toEqual(buildForwardSlots(today))
  })
})

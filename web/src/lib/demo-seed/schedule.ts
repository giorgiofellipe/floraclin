/**
 * Schedule generator for the Clínica Lumé demo seed.
 *
 * Produces two windows of appointments:
 *
 * 1. `buildTodaySlots` -- exactly `TODAY_APPOINTMENTS` slots for the run
 *    date, mostly confirmed, so the day view reads as a clinic mid-shift
 *    rather than an empty calendar.
 * 2. `buildForwardSlots` -- the next `FORWARD_DAYS` calendar days, Monday
 *    to Saturday (the clinic is closed Sundays), `MIN_PER_DAY`-`MAX_PER_DAY`
 *    slots per open day so the upcoming-week and month views never show a
 *    blank day.
 *
 * Every date is derived from the `today` parameter through `@/lib/dates` or
 * pure calendar arithmetic on YYYY-MM-DD components -- never `new Date()`
 * with no arguments, never a bare `new Date('YYYY-MM-DD')`. That keeps the
 * output identical no matter which day of the month (or which host TZ) the
 * seed runs on, including month-end days like the 28th or the 31st.
 *
 * Status strings ('scheduled', 'confirmed') and the appointment day being
 * closed on Sunday only are taken from `AppointmentStatus` in
 * `web/src/types/index.ts` and from the STATUS_LEGEND / weekday handling in
 * `web/src/components/scheduling/calendar-view.tsx`, not invented here.
 */

import { parseBrDate, toBrYmd } from '@/lib/dates'
import { CATALOGUE, FORWARD_DAYS, MAX_PER_DAY, MIN_PER_DAY, TODAY_APPOINTMENTS } from './config'
import type { AppointmentStatus } from '@/types'

export interface PlannedAppointment {
  patientIndex: number
  procedureName: string
  price: number
  durationMin: number
  /** BR calendar day, YYYY-MM-DD. */
  date: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  /** Set only for encaixe / retorno slots; absent for a routine booking. */
  notes?: string
}

// ─── Pure calendar helpers (no Date parsing, no host-TZ dependence) ──────
// Duplicated from revenue.ts rather than shared: Group B generators import
// only config.ts and types.ts, no cross-generator files.

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

/** Adds (or subtracts) whole days to a YYYY-MM-DD string via calendar arithmetic. */
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

/**
 * 0 = Sunday ... 6 = Saturday. Reads the weekday off a BR-noon anchor
 * (`parseBrDate`) so the result never depends on the host process's TZ --
 * same pattern `revenue.ts` uses for `isBusinessDay`.
 */
function weekdayOf(day: string): number {
  return parseBrDate(day, '12:00:00').getDay()
}

/** The clinic is open Monday-Saturday; Sunday is the only closed day. */
function isOpenDay(day: string): boolean {
  return weekdayOf(day) !== 0
}

function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ─── Procedure selection ──────────────────────────────────────────────

/**
 * Only "Harmonização facial completa" runs this long in the catalogue.
 * Capping the book to at most one such booking per day keeps a 5-slot day
 * comfortably inside working hours no matter which items the rotation
 * lands on.
 */
const LONG_DURATION_THRESHOLD_MIN = 90

/**
 * Picks `count` catalogue items by rotating through `CATALOGUE`, mixing
 * procedures within the day, and never selecting a second long (>=90 min)
 * item once one has been placed.
 */
function selectItemsForDay(count: number, rotationOffset: number) {
  const items: typeof CATALOGUE = []
  let hasLongItem = false
  let rotation = rotationOffset
  const guardLimit = count * CATALOGUE.length * 2

  for (let guard = 0; items.length < count && guard < guardLimit; guard++) {
    const candidate = CATALOGUE[rotation % CATALOGUE.length]
    rotation += 1
    if (candidate.durationMin >= LONG_DURATION_THRESHOLD_MIN) {
      if (hasLongItem) continue
      hasLongItem = true
    }
    items.push(candidate)
  }

  return items
}

// ─── Slot placement ───────────────────────────────────────────────────

/**
 * Rotating list of off-hour minute offsets -- 09:00 sharp is how a
 * spreadsheet books a day; a real book staggers starts (09:30, 11:15,
 * 14:45) so consecutive bookings never land on a uniform grid.
 */
const OFFSET_MINUTES = [30, 15, 45, 50, 20, 5, 35, 10]

/** Minimum breathing room the practitioner gets between two bookings. */
const MIN_GAP_MINUTES = 15

interface PlacedSlot {
  procedureName: string
  price: number
  durationMin: number
  startTime: string
  endTime: string
}

/**
 * Places `items` sequentially from `windowStart`, each start offset from
 * the previous end by a rotating (never-uniform) gap, so within one
 * practitioner's day no two slots ever overlap. `seed` varies the rotation
 * per day so consecutive days don't share the same pattern.
 */
function placeSlots(
  items: Array<{ name: string; price: number; durationMin: number }>,
  windowStart: number,
  seed: number,
): PlacedSlot[] {
  let cursor = windowStart

  return items.map((item, index) => {
    const offset = OFFSET_MINUTES[(seed + index) % OFFSET_MINUTES.length]
    const gap = index === 0 ? offset : MIN_GAP_MINUTES + (offset % 30)
    const start = cursor + gap
    const end = start + item.durationMin
    cursor = end

    return {
      procedureName: item.name,
      price: item.price,
      durationMin: item.durationMin,
      startTime: minutesToHHMM(start),
      endTime: minutesToHHMM(end),
    }
  })
}

// ─── Today ────────────────────────────────────────────────────────────

const TODAY_WINDOW_START = 9 * 60 // 09:00

/**
 * Three confirmed, one still just scheduled -- how a real day looks by
 * mid-morning: most patients confirmed via WhatsApp, one still pending.
 */
const TODAY_STATUSES: AppointmentStatus[] = ['confirmed', 'confirmed', 'confirmed', 'scheduled']

/** Exactly `TODAY_APPOINTMENTS` slots for the run date, between 09:00 and 17:00. */
export function buildTodaySlots(today: Date): PlannedAppointment[] {
  const date = toBrYmd(today)
  const items = selectItemsForDay(TODAY_APPOINTMENTS, 0)
  const placed = placeSlots(
    items.map((item) => ({ name: item.name, price: item.price, durationMin: item.durationMin })),
    TODAY_WINDOW_START,
    0,
  )

  return placed.map((slot, index) => ({
    patientIndex: index,
    procedureName: slot.procedureName,
    price: slot.price,
    durationMin: slot.durationMin,
    date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: TODAY_STATUSES[index % TODAY_STATUSES.length],
  }))
}

// ─── Forward window ───────────────────────────────────────────────────

const FORWARD_WINDOW_START = 8 * 60 // 08:00

/** How many of the soonest open days get one encaixe each. Total is always 2. */
const ENCAIXE_DAY_COUNT = 2
/** Roughly one in four slots (outside the encaixe days) reads as a follow-up. */
const RETURN_EVERY_N = 4

const ENCAIXE_NOTE = 'Encaixe - paciente encaixado na agenda'
const RETURN_NOTE = 'Retorno de acompanhamento'

/**
 * The next `FORWARD_DAYS` calendar days, Monday-Saturday only (Sunday is
 * closed), `MIN_PER_DAY`-`MAX_PER_DAY` slots per open day so no open day is
 * ever empty. The two soonest open days each carry one encaixe -- a
 * squeezed-in patient close enough to today to read as "we made room", not
 * a routine booking three weeks out -- and a handful of other slots read
 * as follow-up visits rather than new sales.
 */
export function buildForwardSlots(today: Date): PlannedAppointment[] {
  const todayYmd = toBrYmd(today)

  const openDays: string[] = []
  for (let offset = 1; offset <= FORWARD_DAYS; offset++) {
    const day = addDaysYmd(todayYmd, offset)
    if (isOpenDay(day)) openDays.push(day)
  }

  const slots: PlannedAppointment[] = []
  let patientIndex = 0
  let encaixesPlaced = 0

  openDays.forEach((day, dayIndex) => {
    const count = MIN_PER_DAY + (dayIndex % (MAX_PER_DAY - MIN_PER_DAY + 1))
    const items = selectItemsForDay(count, dayIndex * 3)
    const placed = placeSlots(
      items.map((item) => ({ name: item.name, price: item.price, durationMin: item.durationMin })),
      FORWARD_WINDOW_START,
      dayIndex,
    )

    placed.forEach((slot, slotIndex) => {
      const markEncaixe = slotIndex === 0 && dayIndex < ENCAIXE_DAY_COUNT && encaixesPlaced < ENCAIXE_DAY_COUNT
      if (markEncaixe) encaixesPlaced += 1

      const isReturn = !markEncaixe && (dayIndex + slotIndex) % RETURN_EVERY_N === 0

      slots.push({
        patientIndex,
        procedureName: slot.procedureName,
        price: slot.price,
        durationMin: slot.durationMin,
        date: day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        // Nearest open day reads as already confirmed; further-out days
        // are still just scheduled, like a real upcoming-week view.
        status: dayIndex === 0 ? 'confirmed' : 'scheduled',
        notes: markEncaixe ? ENCAIXE_NOTE : isReturn ? RETURN_NOTE : undefined,
      })
      patientIndex += 1
    })
  })

  return slots
}

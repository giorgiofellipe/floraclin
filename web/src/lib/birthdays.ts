/**
 * Birthday range helpers. Convert a BR-local YYYY-MM-DD window into a flat
 * list of `{ month, day }` pairs that can drive a `EXTRACT(MONTH/DAY)` query.
 *
 * Date conventions: see AGENTS.md → "Date & timezone conventions". Always
 * route YYYY-MM-DD strings through `@/lib/dates`. Never bare `new Date(ymd)`.
 */

import { addDays } from 'date-fns'
import { brToday, parseBrDate } from '@/lib/dates'

/**
 * Build the list of `(month, day)` pairs covering the inclusive BR-local
 * range `[from, to]`. Both `from` and `to` are `YYYY-MM-DD` strings.
 *
 * Year-wrap is implicit: ranges that span December → January work because we
 * iterate day-by-day in BR-local time, then take month/day off each cursor.
 *
 * Leap-year fallback: if the range includes Feb 28 and the current BR year
 * is not a leap year, we also emit Feb 29 so that patients born on Feb 29 are
 * surfaced on Feb 28 in non-leap years.
 */
export function birthdayMonthDayPairs(args: {
  from: string
  to: string
}): Array<{ month: number; day: number }> {
  const pairs: Array<{ month: number; day: number }> = []
  let cursor = parseBrDate(args.from, '12:00:00')
  const end = parseBrDate(args.to, '12:00:00')

  // Safety cap — guard against pathological inputs (no UI sends >366 days).
  const MAX_DAYS = 400
  let steps = 0
  while (cursor.getTime() <= end.getTime() && steps < MAX_DAYS) {
    pairs.push({ month: cursor.getMonth() + 1, day: cursor.getDate() })
    cursor = addDays(cursor, 1)
    steps += 1
  }

  const currentYear = parseInt(brToday().slice(0, 4), 10)
  const isLeap =
    (currentYear % 4 === 0 && currentYear % 100 !== 0) || currentYear % 400 === 0
  if (
    !isLeap &&
    pairs.some((p) => p.month === 2 && p.day === 28) &&
    !pairs.some((p) => p.month === 2 && p.day === 29)
  ) {
    pairs.push({ month: 2, day: 29 })
  }

  return pairs
}

/**
 * Returns today's BR-local `(month, day)`. Use as the default range when the
 * caller doesn't pass a window.
 */
export function todayMonthDay(): { month: number; day: number } {
  const today = brToday() // 'YYYY-MM-DD' BR-anchored
  return {
    month: parseInt(today.slice(5, 7), 10),
    day: parseInt(today.slice(8, 10), 10),
  }
}

/**
 * Returns the current BR-local year as an integer. Used as the default
 * `occasion_year` for greeting records.
 */
export function currentBrYear(): number {
  return parseInt(brToday().slice(0, 4), 10)
}

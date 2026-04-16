/**
 * Date / timezone helpers — the single source of truth for this app.
 *
 * Context: Brazil-only product. Production servers nominally run in
 * America/Sao_Paulo, but containers (Vercel, CI) run UTC. Using the bare
 * `new Date(yyyymmdd)` constructor parses as UTC midnight, which silently
 * shifts to the previous day in BR. This module exists to make the
 * correct behaviour trivially reachable.
 *
 * See AGENTS.md → "Date & timezone conventions" for the rule set.
 */

import { format } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const BR_TZ = 'America/Sao_Paulo'

const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a `YYYY-MM-DD` string as BR-local time at the given clock time.
 * Returns a JS `Date` (UTC instant) that corresponds to the given wall-clock
 * time in São Paulo, regardless of the host's TZ.
 *
 * Use for: server-side range boundaries that compare against `timestamptz`
 * columns, and anywhere a BR calendar date must be anchored to a BR instant.
 *
 * @example
 *   startOfBrDay('2026-04-13') // 2026-04-13T03:00:00.000Z
 *   endOfBrDay('2026-04-13')   // 2026-04-14T02:59:59.999Z
 */
export function parseBrDate(ymd: string, time: string = '12:00:00'): Date {
  if (!YMD_ONLY.test(ymd)) {
    throw new Error(`parseBrDate expected YYYY-MM-DD, got ${ymd}`)
  }
  return fromZonedTime(`${ymd}T${time}`, BR_TZ)
}

/** BR-local start of day → UTC instant. Use for date-range filter lower bound. */
export function startOfBrDay(ymd: string): Date {
  return parseBrDate(ymd, '00:00:00')
}

/** BR-local end of day → UTC instant. Use for date-range filter upper bound. */
export function endOfBrDay(ymd: string): Date {
  return parseBrDate(ymd, '23:59:59.999')
}

/**
 * Parse a `YYYY-MM-DD` string as a wall-clock Date at noon. Use on the
 * client (browser) when the value represents a calendar day the user
 * picked — noon anchor gives ±12h slack against TZ/DST drift.
 *
 * Do NOT use on the server for filter comparisons against timestamptz.
 * Use `startOfBrDay` / `endOfBrDay` instead.
 */
export function parseLocalDate(ymd: string, time: string = '12:00:00'): Date {
  if (!YMD_ONLY.test(ymd)) {
    throw new Error(`parseLocalDate expected YYYY-MM-DD, got ${ymd}`)
  }
  return new Date(`${ymd}T${time}`)
}

/**
 * "Today" as a `YYYY-MM-DD` string in BR time — regardless of host TZ.
 * Replaces `format(new Date(), 'yyyy-MM-dd')`, which uses process TZ.
 */
export function brToday(): string {
  return formatInTimeZone(new Date(), BR_TZ, 'yyyy-MM-dd')
}

/**
 * Format a `Date` instant as a `YYYY-MM-DD` string in BR time. Use when the
 * semantic answer is "which BR calendar day did this instant fall on".
 */
export function toBrYmd(date: Date): string {
  return formatInTimeZone(date, BR_TZ, 'yyyy-MM-dd')
}

/**
 * Format a `Date` as a `YYYY-MM-DD` string using **local** getters.
 * Prefer `toBrYmd` on the server. Use this only when you're formatting a
 * Date that was constructed from a DB `date` column (Drizzle round-trips
 * local getters to preserve y/m/d) or a client-side pick.
 *
 * Never use `date.toISOString().split('T')[0]` — it converts to UTC first
 * and can flip the day.
 */
export function toLocalYmd(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

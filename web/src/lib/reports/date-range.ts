import { brToday, isValidYmd, shiftBrYmd } from '@/lib/dates'

/**
 * Outcome of resolving a report's `dateFrom`/`dateTo` query params into a
 * complete, ordered range. `ok: false` carries the Brazilian Portuguese
 * message the route returns with a 400.
 */
export type ResolvedDateRange =
  | { ok: true; dateFrom: string; dateTo: string }
  | { ok: false; error: string }

interface ResolveDateRangeOptions {
  /** Width of the default window in days, from the report's registry entry
   *  (`ReportDefinition.defaultRangeDays`). Never hardcode it in a route:
   *  the filter UI seeds the date inputs from the same field, and the two
   *  must not drift apart. */
  defaultRangeDays: number
  /** BR calendar day to treat as "today". Defaults to `brToday()`; tests
   *  pass a fixed day so they don't depend on the clock. */
  today?: string
}

/**
 * Completes a possibly partial date range instead of rejecting it. Picking
 * only a start date (or only an end date) is a normal thing to ask for, and
 * used to return a 400 that read to the user as "the report is broken".
 *
 * - both absent  -> the last `defaultRangeDays` days up to today
 * - only `from`  -> `from` through today
 * - only `to`    -> `defaultRangeDays` days before `to`, through `to`
 * - both present -> used as given
 *
 * Still a 400: a value that isn't a real `YYYY-MM-DD` calendar day, and an
 * explicitly given `from` later than an explicitly given `to`.
 */
export function resolveDateRange(
  rawDateFrom: string | null | undefined,
  rawDateTo: string | null | undefined,
  { defaultRangeDays, today = brToday() }: ResolveDateRangeOptions,
): ResolvedDateRange {
  const from = rawDateFrom?.trim() ?? ''
  const to = rawDateTo?.trim() ?? ''

  if (from && !isValidYmd(from)) return { ok: false, error: 'Data inicial inválida' }
  if (to && !isValidYmd(to)) return { ok: false, error: 'Data final inválida' }

  if (!from && !to) {
    return { ok: true, dateFrom: shiftBrYmd(today, -defaultRangeDays), dateTo: today }
  }

  if (from && !to) {
    // A start date in the future would invert the range once completed with
    // today. Clamp to a single-day window rather than 400ing: the user never
    // typed an end date, so blaming them for an ordering they didn't choose
    // is exactly the unhelpful error this function exists to remove.
    return { ok: true, dateFrom: from, dateTo: from > today ? from : today }
  }

  if (!from && to) {
    return { ok: true, dateFrom: shiftBrYmd(to, -defaultRangeDays), dateTo: to }
  }

  // Both explicitly given: an inverted range is a real user error, so say so.
  if (from > to) return { ok: false, error: 'Data inicial posterior à data final' }

  return { ok: true, dateFrom: from, dateTo: to }
}

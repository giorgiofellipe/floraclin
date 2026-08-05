import { db } from '@/db/client'
import { patients, appointments, procedureTypes } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { subDays } from 'date-fns'
import { parseBrDate, toBrYmd } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

/** Appointment statuses that count as a missed slot for this report. */
const MISSED_STATUSES = new Set(['no_show', 'cancelled'])

export interface RepeatNoShowRow {
  patientId: string
  fullName: string
  phone: string
  missedCount: number
  dates: string[]
  missedValue: number
}

/** Server-recognized sort keys for this report. The route validates an
 *  incoming `sort` query param against this same list before it ever reaches
 *  this function. */
export type RepeatNoShowSortKey = 'fullName' | 'missedCount' | 'missedValue'

export interface ListRepeatNoShowsOptions {
  windowDays: number
  minCount: number
  today: Date
  /** Explicit sort requested by the caller. When absent, rows keep the
   *  default order (missed count descending, then missed value
   *  descending). */
  sort?: { key: RepeatNoShowSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<RepeatNoShowSortKey, (row: RepeatNoShowRow) => string | number | null> = {
  fullName: (row) => row.fullName,
  missedCount: (row) => row.missedCount,
  missedValue: (row) => row.missedValue,
}

/** Report results are capped at this many rows, matching the precedent in
 *  `web/src/db/queries/followups.ts`. Applied after sorting so the cap keeps
 *  the most important rows (highest missed count, then highest missed
 *  value), not an arbitrary DB-order slice. */
const MAX_ROWS = 200

/**
 * Recall report: patients who repeatedly no-show or cancel.
 *
 * Counts appointments in status `no_show` or `cancelled` whose `date` falls
 * within the last `windowDays` (inclusive of the boundary day, mirroring how
 * `due-followups` treats its window end as inclusive) AND is not in the
 * future: the window runs through today, so a cancellation dated after today
 * (e.g. a patient cancelling next month's appointment) is not a miss yet and
 * must not be counted. A patient is included only when that count reaches
 * `minCount` or more.
 *
 * `appointments.date` is a `date` column holding a BR calendar day, compared
 * throughout as a `YYYY-MM-DD` string. It is never passed through
 * `new Date()`. `today` is taken as a parameter rather than read from
 * `Date.now()` so callers (and tests) control the reference instant
 * explicitly.
 *
 * `missedValue` sums the appointment's procedure type `defaultPrice` across
 * every counted occurrence, treating a missing procedure type or a null
 * price as 0 rather than producing `NaN`.
 *
 * Ordered by missed count descending, then missed value descending, capped
 * at `MAX_ROWS`.
 */
export async function listRepeatNoShows(
  tenantId: string,
  { windowDays, minCount, today, sort }: ListRepeatNoShowsOptions,
): Promise<RepeatNoShowRow[]> {
  const todayYmd = toBrYmd(today)
  const windowStartYmd = toBrYmd(subDays(parseBrDate(todayYmd), windowDays))

  const rows = await db
    .select({
      patientId: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      status: appointments.status,
      date: appointments.date,
      defaultPrice: procedureTypes.defaultPrice,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        isNull(appointments.deletedAt),
        isNull(patients.deletedAt),
      ),
    )

  const byPatient = new Map<
    string,
    { fullName: string; phone: string; dates: string[]; missedValue: number }
  >()

  for (const row of rows) {
    if (!MISSED_STATUSES.has(row.status)) continue
    // The window starts `windowDays` ago (inclusive) and runs through today
    // (inclusive), not beyond it. A future-dated cancellation (e.g. next
    // month's appointment cancelled today) has not happened yet and is not
    // a miss, so the upper bound matters just as much as the lower one.
    if (row.date < windowStartYmd) continue
    if (row.date > todayYmd) continue

    const entry = byPatient.get(row.patientId) ?? {
      fullName: row.fullName,
      phone: row.phone,
      dates: [],
      missedValue: 0,
    }
    entry.dates.push(row.date)
    entry.missedValue += row.defaultPrice == null ? 0 : Number(row.defaultPrice)
    byPatient.set(row.patientId, entry)
  }

  const result: RepeatNoShowRow[] = []

  for (const [patientId, entry] of byPatient) {
    if (entry.dates.length < minCount) continue
    result.push({
      patientId,
      fullName: entry.fullName,
      phone: entry.phone,
      missedCount: entry.dates.length,
      dates: entry.dates,
      missedValue: entry.missedValue,
    })
  }

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    result.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    result.sort((a, b) => b.missedCount - a.missedCount || b.missedValue - a.missedValue)
  }

  // The cap MUST apply after sorting, not before: with an explicit sort the
  // "top 200" has to be the top 200 of the requested order.
  return result.slice(0, MAX_ROWS)
}

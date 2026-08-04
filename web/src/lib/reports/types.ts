export type ReportFilterKind = 'date-range' | 'threshold-days' | 'practitioner' | 'min-count'

export interface ReportColumn<Row> {
  key: string
  header: string
  /** Rendered in the table and written to CSV. Keep them the same so the
   *  exported file and the screen can never disagree. */
  value: (row: Row) => string
  align?: 'left' | 'right'
  /** Enables a clickable, sortable header for this column. Only set it on
   *  columns backed by a value the report's route actually knows how to
   *  order by (see that route's sort-key allow-list); a purely derived or
   *  free-text display column should leave this unset. */
  sortable?: boolean
  /** Query-string `sort` value this column corresponds to server-side.
   *  Defaults to `key` when omitted; only needed when the two differ. */
  sortKey?: string
}

/** Active sort for a report: the server-recognized key plus direction. Both
 *  the fetch and the export URLs carry this so an export always matches what
 *  is on screen. */
export interface ReportSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface ReportDefinition {
  slug: string
  title: string
  description: string
  filters: ReportFilterKind[]
  /** The API route that serves this report's data and export formats, e.g.
   *  `/api/reports/inactive-patients`. Export links are built from this, not
   *  from the page's own URL (`/relatorios/<slug>`), since the two never
   *  match. */
  apiPath: string
  /** Query-string key the numeric day-count filter must serialize under when
   *  hitting `apiPath`. The filter UI always stores the value under
   *  `thresholdDays` (see `ReportFilterValues`), but the route itself may
   *  expect a different name (`windowDays`) depending on what the number
   *  actually means for that report. */
  paramName: 'thresholdDays' | 'windowDays'
  /** Default value for the day-count filter, shown pre-filled in the UI and
   *  used by the API route when no param (or a blank one) is sent. This is
   *  the single source of truth for the default: both the filter UI and the
   *  route import it from here rather than each keeping their own constant,
   *  so they cannot drift apart. */
  defaultDays: number
  /** Label for the day-count filter control. The `threshold-days` kind means
   *  a different thing per report (a floor below which a patient counts as
   *  lapsed, a lookahead/overdue window, a lookback window), so the copy has
   *  to be per-report rather than a single generic string shared by all
   *  three. */
  filterLabel: string
  /** Default value for the `min-count` filter, read by both the UI and the
   *  route, same reasoning as `defaultDays`. Only set by reports that declare
   *  the `min-count` filter kind (today, just `faltas`). */
  defaultMinCount?: number
}

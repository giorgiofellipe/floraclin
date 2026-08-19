export type ReportFilterKind = 'date-range' | 'threshold-days' | 'practitioner' | 'min-count' | 'patient'

/** Category a report is grouped under on the /relatorios landing page. A
 *  union, not a free string, so declaring a report under a group that
 *  doesn't exist is a type error rather than a silently-dropped card. Group
 *  order and per-group copy live in the registry (see `REPORT_GROUPS`), not
 *  here or on the landing page, so adding a group is a registry-only
 *  change. */
export type ReportGroup = 'pacientes' | 'financeiro' | 'clinico'

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
  /** Category this report is grouped under on the /relatorios landing page.
   *  A required union field so a new report must declare a valid group; an
   *  unrecognized value fails the build rather than silently landing
   *  outside every section. See `REPORT_GROUPS` in `./registry` for the
   *  group order and per-group heading/subtitle. */
  group: ReportGroup
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
   *  actually means for that report. Only relevant to reports that declare
   *  the `threshold-days` filter kind; omit it otherwise (the sub-project 2
   *  exports use `date-range`/`practitioner` instead and never touch this). */
  paramName?: 'thresholdDays' | 'windowDays'
  /** Default value for the day-count filter, shown pre-filled in the UI and
   *  used by the API route when no param (or a blank one) is sent. This is
   *  the single source of truth for the default: both the filter UI and the
   *  route import it from here rather than each keeping their own constant,
   *  so they cannot drift apart. Only relevant to reports that declare the
   *  `threshold-days` filter kind. */
  defaultDays?: number
  /** Label for the day-count filter control. The `threshold-days` kind means
   *  a different thing per report (a floor below which a patient counts as
   *  lapsed, a lookahead/overdue window, a lookback window), so the copy has
   *  to be per-report rather than a single generic string shared by all
   *  three. Only relevant to reports that declare the `threshold-days`
   *  filter kind. */
  filterLabel?: string
  /** Default value for the `min-count` filter, read by both the UI and the
   *  route, same reasoning as `defaultDays`. Only set by reports that declare
   *  the `min-count` filter kind (today, just `faltas`). */
  defaultMinCount?: number
  /** Width, in days, of the default date range: `today - defaultRangeDays`
   *  through `today`. Read by both the filter UI (which seeds the two date
   *  inputs with it, so the user can see the active window) and the report's
   *  route (which applies it when neither `dateFrom` nor `dateTo` is sent),
   *  so the screen and the server cannot disagree about what "no dates
   *  picked" means. Only relevant to reports that declare the `date-range`
   *  filter kind. */
  defaultRangeDays?: number
  /** Second line of the empty state, telling the user which filter to loosen
   *  when the report has no rows. Per-report because the fix differs: some
   *  reports need a wider period, `pacientes-inativos` needs a *smaller*
   *  day count, `faltas` has two knobs. */
  emptyHint?: string
}

export type ReportFilterKind = 'date-range' | 'threshold-days' | 'practitioner'

export interface ReportColumn<Row> {
  key: string
  header: string
  /** Rendered in the table and written to CSV. Keep them the same so the
   *  exported file and the screen can never disagree. */
  value: (row: Row) => string
  align?: 'left' | 'right'
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
}

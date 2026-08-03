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
}

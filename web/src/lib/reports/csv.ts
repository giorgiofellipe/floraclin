import type { ReportColumn } from './types'

const FORMULA_PREFIXES = ['=', '+', '-', '@']

/**
 * Escapes a single CSV field per RFC 4180, and guards against formula
 * injection. Values in this codebase can come straight from patient names or
 * notes, and Excel/Sheets will execute a leading "=", "+", "-" or "@" as a
 * formula unless it is neutralized first.
 */
function escapeCsvField(raw: string): string {
  let value = raw

  if (FORMULA_PREFIXES.includes(value.charAt(0))) {
    value = `'${value}`
  }

  const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')

  if (needsQuoting) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

/**
 * Renders rows to a CSV string using the same column.value function the
 * on-screen table uses, so the exported file and the screen can never
 * disagree. Always emits a header row, even for an empty row set.
 */
export function toCsv<Row>(rows: Row[], columns: ReportColumn<Row>[]): string {
  const header = columns.map((column) => escapeCsvField(column.header)).join(',')

  const lines = rows.map((row) => columns.map((column) => escapeCsvField(column.value(row))).join(','))

  return [header, ...lines].join('\r\n')
}

/** Builds a stable, timestamped filename for a report export. */
export function csvFilename(slug: string, today: string): string {
  return `${slug}-${today}.csv`
}

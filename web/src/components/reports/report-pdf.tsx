import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import { BR_TZ } from '@/lib/dates'
import type { ReportColumn } from '@/lib/reports/types'

/**
 * Extra CSS for the report's table, layered on top of `PRINT_BASE_CSS` (which
 * has no table rules of its own). Pass `${PRINT_BASE_CSS}${REPORT_PDF_CSS}` as
 * the second argument to `renderReactToPdf`.
 */
export const REPORT_PDF_CSS = `
  table.report-pdf-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 12px; }
  table.report-pdf-table th, table.report-pdf-table td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  table.report-pdf-table th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  table.report-pdf-table th.report-pdf-align-right, table.report-pdf-table td.report-pdf-align-right { text-align: right; }
  .report-pdf-generated-at { margin-top: 1.5rem; font-size: 10px; color: #888; text-align: right; }
`

interface ReportPdfProps<Row> {
  clinicName: string
  reportTitle: string
  /** Human readable summary of the filters in effect, e.g. "Limite: 180 dias". */
  filterSummary: string
  rows: Row[]
  columns: ReportColumn<Row>[]
  generatedAt: Date
}

/**
 * `generatedAt` is a real instant, not a calendar day, so it is formatted in
 * BR time explicitly rather than with host-local getters — the container
 * this renders in (Vercel/Lambda via `renderReactToPdf`) runs UTC.
 */
function formatBrTimestamp(date: Date): string {
  return formatInTimeZone(date, BR_TZ, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/**
 * Printable version of a report: clinic name, report title, the filters that
 * produced the rows, the table itself (rendered through the same
 * `column.value` used on screen and in the CSV export) and a generation
 * timestamp. Rendered server-side via `renderReactToPdf` from `@/lib/pdf`.
 */
export function ReportPdf<Row>({
  clinicName,
  reportTitle,
  filterSummary,
  rows,
  columns,
  generatedAt,
}: ReportPdfProps<Row>) {
  return (
    <div>
      <header>
        <div>
          <div className="clinic-name">{clinicName}</div>
        </div>
      </header>

      <h1>{reportTitle}</h1>
      {filterSummary && <div className="meta-row">{filterSummary}</div>}

      <table className="report-pdf-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.align === 'right' ? 'report-pdf-align-right' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length || 1}>
                Nenhum registro encontrado para os filtros selecionados.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={column.align === 'right' ? 'report-pdf-align-right' : undefined}
                  >
                    {column.value(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="report-pdf-generated-at">Gerado em {formatBrTimestamp(generatedAt)}</div>
    </div>
  )
}

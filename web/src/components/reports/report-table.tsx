import type { ReactNode } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from 'lucide-react'
import type { ReportColumn, ReportSort } from '@/lib/reports/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ReportTableProps<Row> {
  rows: Row[]
  columns: ReportColumn<Row>[]
  /**
   * Optional trailing action column (e.g. "open on WhatsApp"). `column.value`
   * only returns plain text, since it also feeds the CSV/PDF export, so a
   * per-row action that renders markup goes through this prop instead of a
   * column. Reports that need one no longer have to duplicate the whole
   * table markup just to append it (see the old pacientes-inativos page).
   */
  rowAction?: (row: Row) => ReactNode
  /**
   * Optional extra class name for a row, e.g. to flag an overdue follow-up.
   * Merged with the row's base classes via `cn`, so it can add or override
   * without needing to know them.
   */
  rowClassName?: (row: Row) => string | undefined
  /** Active sort, owned by the page's `ReportShell`. Sorting is resolved
   *  server-side (see each report's route), since every report caps at 200
   *  rows AFTER sorting by its urgency order — a client-only sort would
   *  reorder only the rows that survived that cap. This prop only decides
   *  which header shows the active indicator. */
  sort?: ReportSort
  /** Called with the column's `sortKey` (falling back to `key`) when a
   *  sortable header is clicked. Absent when the caller has nowhere to send
   *  a sort change; sortable headers then render without a click handler. */
  onSortChange?: (key: string) => void
}

/**
 * Renders a report's rows through the same `column.value` function the CSV
 * writer uses (see `@/lib/reports/csv.ts`), so the screen and the export can
 * never disagree.
 */
export function ReportTable<Row>({
  rows,
  columns,
  rowAction,
  rowClassName,
  sort,
  onSortChange,
}: ReportTableProps<Row>) {
  const colSpan = columns.length + (rowAction ? 1 : 0) || 1

  return (
    <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-[#E8ECEF]">
            {columns.map((column) => {
              const sortKey = column.sortKey ?? column.key
              const isActive = column.sortable && sort?.key === sortKey
              const ariaSort = !column.sortable
                ? undefined
                : isActive
                  ? sort!.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'

              return (
                <TableHead
                  key={column.key}
                  aria-sort={ariaSort}
                  className={cn(
                    'text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(sortKey)}
                      className={cn(
                        'inline-flex items-center gap-1 uppercase tracking-[0.15em] text-[10px] font-medium hover:text-charcoal transition-colors',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      <span>{column.header}</span>
                      {isActive ? (
                        sort!.dir === 'asc' ? (
                          <ArrowUpIcon className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDownIcon className="size-3" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDownIcon className="size-3 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
            {rowAction && (
              <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] font-medium text-right">
                WhatsApp
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="text-center text-mid py-12 whitespace-normal"
              >
                Nenhum registro encontrado para os filtros selecionados.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow
                key={index}
                className={cn(
                  'border-b border-[#E8ECEF] last:border-b-0 hover:bg-[#F4F6F8] transition-colors',
                  rowClassName?.(row),
                )}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      'text-charcoal',
                      column.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {column.value(row)}
                  </TableCell>
                ))}
                {rowAction && <TableCell className="text-right">{rowAction(row)}</TableCell>}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

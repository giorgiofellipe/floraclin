'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { brToday, shiftBrYmd } from '@/lib/dates'
import type { ReportFilterKind, ReportSort } from '@/lib/reports/types'
import { ReportFilters, type ReportFilterValues } from './report-filters'
import { ExportButtons } from './export-buttons'

interface ReportShellProps {
  title: string
  description: string
  filters: ReportFilterKind[]
  /** The report's API route, threaded through to `ExportButtons` so export
   *  links point at the handler, not at this page's own URL. */
  apiPath: string
  /** Query-string key the numeric day-count filter must serialize under for
   *  this report's route (`thresholdDays` or `windowDays`). Only present on
   *  reports that declare the `threshold-days` filter kind. */
  paramName?: 'thresholdDays' | 'windowDays'
  /** Default value for the day-count filter, from the report's registry
   *  entry. Seeds the filter on first render so the input never shows blank
   *  and the export links carry it before the user touches anything. Only
   *  present on reports that declare the `threshold-days` filter kind. */
  defaultDays?: number
  /** Label for the day-count filter input, from the report's registry entry
   *  (see `web/src/lib/reports/registry.ts`): the same filter kind means a
   *  different thing per report. Only present on reports that declare the
   *  `threshold-days` filter kind. */
  filterLabel?: string
  /** Default value for the `min-count` filter, from the report's registry
   *  entry. Only relevant when `filters` includes `'min-count'`. */
  defaultMinCount?: number
  /** Width in days of the default date range, from the report's registry
   *  entry. Seeds both date inputs on first render (today minus this many
   *  days, through today) so the user can SEE the window the table is
   *  showing, and so the export links carry it before anything is touched.
   *  Only present on reports that declare the `date-range` filter kind. */
  defaultRangeDays?: number
  /** Table area, rendered with the currently active filter values and sort
   *  state so the report page can fetch and display the matching rows. The
   *  shell owns the sort state (not the page) because it also has to feed
   *  `ExportButtons`, so an export always matches what is on screen. */
  children: (
    filters: ReportFilterValues,
    sort: ReportSort | undefined,
    onSortChange: (key: string) => void,
  ) => ReactNode
}

/**
 * Owns filters, sort state, export wiring and layout for a single report:
 * the header, the filter bar, the export buttons and the table area. Adding
 * a report means writing a query and columns, never a page layout.
 */
export function ReportShell({
  title,
  description,
  filters,
  apiPath,
  paramName,
  defaultDays,
  filterLabel,
  defaultMinCount,
  defaultRangeDays,
  children,
}: ReportShellProps) {
  const [filterValues, setFilterValues] = useState<ReportFilterValues>(() => {
    const initial: ReportFilterValues = {}
    if (filters.includes('threshold-days') && defaultDays !== undefined) {
      initial.thresholdDays = String(defaultDays)
    }
    if (filters.includes('min-count') && defaultMinCount !== undefined) {
      initial.minCount = String(defaultMinCount)
    }
    if (filters.includes('date-range') && defaultRangeDays !== undefined) {
      // Seeded rather than left blank: an empty picker hides which window the
      // table is actually showing, and the export link would then have to
      // rely on the route's own fallback to agree with the screen.
      const today = brToday()
      initial.dateFrom = shiftBrYmd(today, -defaultRangeDays)
      initial.dateTo = today
    }
    return initial
  })

  // No sort param sent (`undefined`) means "use the route's own default
  // urgency order" — the shell never picks an initial sort of its own.
  const [sort, setSort] = useState<ReportSort | undefined>(undefined)

  const handleSortChange = useCallback((key: string) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-medium text-charcoal">{title}</h1>
          <p className="mt-1 text-sm text-mid">{description}</p>
        </div>
        <ExportButtons apiPath={apiPath} paramName={paramName} filters={filterValues} sort={sort} />
      </div>

      {filters.length > 0 && (
        <ReportFilters
          filters={filters}
          value={filterValues}
          onChange={setFilterValues}
          dayFilterLabel={filterLabel}
        />
      )}

      <div>{children(filterValues, sort, handleSortChange)}</div>
    </div>
  )
}

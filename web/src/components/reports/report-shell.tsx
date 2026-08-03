'use client'

import { useState, type ReactNode } from 'react'
import type { ReportFilterKind } from '@/lib/reports/types'
import { ReportFilters, type ReportFilterValues } from './report-filters'
import { ExportButtons } from './export-buttons'

interface ReportShellProps {
  title: string
  description: string
  filters: ReportFilterKind[]
  /** Table area, rendered with the currently active filter values so the
   *  report page can fetch and display the matching rows. */
  children: (filters: ReportFilterValues) => ReactNode
}

/**
 * Owns filters, export wiring and layout for a single report: the header,
 * the filter bar, the export buttons and the table area. Adding a report
 * means writing a query and columns, never a page layout.
 */
export function ReportShell({ title, description, filters, children }: ReportShellProps) {
  const [filterValues, setFilterValues] = useState<ReportFilterValues>({})

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-medium text-charcoal">{title}</h1>
          <p className="mt-1 text-sm text-mid">{description}</p>
        </div>
        <ExportButtons filters={filterValues} />
      </div>

      {filters.length > 0 && (
        <ReportFilters filters={filters} value={filterValues} onChange={setFilterValues} />
      )}

      <div>{children(filterValues)}</div>
    </div>
  )
}

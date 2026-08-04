'use client'

import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReportSort } from '@/lib/reports/types'
import type { ReportFilterValues } from './report-filters'

interface ExportButtonsProps {
  /** The report's API route, e.g. `/api/reports/inactive-patients`. Export
   *  links point here, never at the page's own URL: the two never match. */
  apiPath: string
  /** Query-string key the numeric day-count filter (stored under
   *  `thresholdDays` in `ReportFilterValues`) must be renamed to for this
   *  report's route. */
  paramName: 'thresholdDays' | 'windowDays'
  filters: ReportFilterValues
  /** Active sort, owned by `ReportShell`. Carried into the export URL as
   *  `sort`/`dir` so the exported file's row order matches what is on
   *  screen, not the route's default order. */
  sort?: ReportSort
}

/** Builds the export URL for `apiPath`, preserving active filters and the
 *  active sort. The filter UI always keeps the numeric day-count value under
 *  the `thresholdDays` key regardless of what it means for a given report,
 *  so it is renamed to `paramName` here; every other filter key (including
 *  `minCount`, which already matches its route param name) is carried
 *  through unchanged. */
function buildExportUrl(
  apiPath: string,
  format: 'csv' | 'pdf',
  paramName: 'thresholdDays' | 'windowDays',
  filters: ReportFilterValues,
  sort: ReportSort | undefined,
): string {
  const params = new URLSearchParams()
  for (const [key, filterValue] of Object.entries(filters)) {
    if (!filterValue) continue
    const paramKey = key === 'thresholdDays' ? paramName : key
    params.set(paramKey, filterValue)
  }
  if (sort) {
    params.set('sort', sort.key)
    params.set('dir', sort.dir)
  }
  params.set('format', format)
  return `${apiPath}?${params.toString()}`
}

/**
 * CSV and PDF export links for the report currently on screen. Both point at
 * the same API route, differing only by `?format=`, and both carry every
 * active filter plus the active sort so the exported file matches what is
 * shown on screen.
 */
export function ExportButtons({ apiPath, paramName, filters, sort }: ExportButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      <a
        href={buildExportUrl(apiPath, 'csv', paramName, filters, sort)}
        download
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button
          variant="outline"
          size="sm"
          className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
        >
          <DownloadIcon data-icon="inline-start" />
          Exportar CSV
        </Button>
      </a>
      <a
        href={buildExportUrl(apiPath, 'pdf', paramName, filters, sort)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button
          variant="outline"
          size="sm"
          className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
        >
          <FileTextIcon data-icon="inline-start" />
          Exportar PDF
        </Button>
      </a>
    </div>
  )
}

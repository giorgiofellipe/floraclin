'use client'

import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
}

/** Builds the export URL for `apiPath`, preserving active filters. The
 *  filter UI always keeps the numeric day-count value under the
 *  `thresholdDays` key regardless of what it means for a given report, so it
 *  is renamed to `paramName` here; every other filter key is carried through
 *  unchanged. */
function buildExportUrl(
  apiPath: string,
  format: 'csv' | 'pdf',
  paramName: 'thresholdDays' | 'windowDays',
  filters: ReportFilterValues,
): string {
  const params = new URLSearchParams()
  for (const [key, filterValue] of Object.entries(filters)) {
    if (!filterValue) continue
    const paramKey = key === 'thresholdDays' ? paramName : key
    params.set(paramKey, filterValue)
  }
  params.set('format', format)
  return `${apiPath}?${params.toString()}`
}

/**
 * CSV and PDF export links for the report currently on screen. Both point at
 * the same API route, differing only by `?format=`, and both carry every
 * active filter so the exported file matches what is shown on screen.
 */
export function ExportButtons({ apiPath, paramName, filters }: ExportButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      <a
        href={buildExportUrl(apiPath, 'csv', paramName, filters)}
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
        href={buildExportUrl(apiPath, 'pdf', paramName, filters)}
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

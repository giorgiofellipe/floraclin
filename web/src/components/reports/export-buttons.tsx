'use client'

import { usePathname } from 'next/navigation'
import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReportFilterValues } from './report-filters'

interface ExportButtonsProps {
  filters: ReportFilterValues
}

/** Builds the export URL for the current route, preserving active filters. */
function buildExportUrl(
  pathname: string,
  format: 'csv' | 'pdf',
  filters: ReportFilterValues,
): string {
  const params = new URLSearchParams()
  for (const [key, filterValue] of Object.entries(filters)) {
    if (filterValue) params.set(key, filterValue)
  }
  params.set('format', format)
  return `${pathname}?${params.toString()}`
}

/**
 * CSV and PDF export links for the report currently on screen. Both point at
 * the same route, differing only by `?format=`, and both carry every active
 * filter so the exported file matches what is shown on screen.
 */
export function ExportButtons({ filters }: ExportButtonsProps) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-2">
      <a
        href={buildExportUrl(pathname, 'csv', filters)}
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
      <a href={buildExportUrl(pathname, 'pdf', filters)} target="_blank" rel="noopener noreferrer">
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
